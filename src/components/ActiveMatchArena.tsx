import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Swords,
  WifiOff,
} from 'lucide-react';
import {
  OTTGameEngine,
  PIECE_VIET_NAMES,
  type BoardRules,
  type GameState,
  type ValidMove,
} from '../core/ottEngine';
import {
  createNonce,
  generateIdentity,
  hashMove,
  hashState,
  importPublicKey,
  signPayload,
  verifyPayload,
  type ConsensusIdentity,
} from '../core/consensusCrypto';
import { BotRunner } from '../core/botRunner';
import { SAMPLE_BOTS, type SampleBotKey } from '../core/sampleBots';
import { backendClient } from '../core/backendClient';
import { soundFx } from '../core/soundFx';
import { Board9x9 } from './Board9x9';
import { MascotCountsInline } from './HalloweenPieces';
import { useToast } from './ToastProvider';

const BOT_TURN_TIMEOUT_MS = 5000;

export interface ActiveMatchSession {
  source: 'backend' | 'p2p';
  matchId: string;
  roomCode?: string;
  seed: number;
  pieceCount: number;
  mode: 'human' | 'bot';
  mySeat: 1 | 2 | null; // null = spectator
  isHost?: boolean;
  player1Name: string;
  player2Name: string;
  player1Elo?: number;
  player2Elo?: number;
  rules: BoardRules | null;
  tournamentId?: string | null;
  tournamentPhase?: 'practice' | 'ranked' | null;
  isSparring?: boolean;
  // For P2P rooms (PeerJS data channel wrapper)
  p2pSend?: (payload: any) => void;
  subscribePeerData?: (cb: (payload: any) => void) => () => void;
  onHostResetRoom?: () => void;
}

interface ActiveMatchArenaProps {
  session: ActiveMatchSession;
  customEditorCode: string;
  savedBotCode: string;
  hasSavedBot: boolean;
  themeMode: 'halloween' | 'standard';
  onExit: () => void;
  onOpenReplay: (replay: any, p1: string, p2: string) => void;
}

interface MoveLogEntry {
  step: number;
  text: string;
  isCapture?: boolean;
  elapsedMs?: number;
}

export const ActiveMatchArena: React.FC<ActiveMatchArenaProps> = ({
  session,
  customEditorCode,
  savedBotCode,
  hasSavedBot,
  themeMode,
  onExit,
  onOpenReplay,
}) => {
  const { notify } = useToast();

  const [gameState, setGameState] = useState<GameState>(() =>
    OTTGameEngine.createGame(session.seed, session.pieceCount, session.rules)
  );
  const stateRef = useRef<GameState>(gameState);
  stateRef.current = gameState;

  const initialSerializedRef = useRef<any>(
    OTTGameEngine.serialize(
      OTTGameEngine.createGame(session.seed, session.pieceCount, session.rules)
    )
  );

  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [validMoves, setValidMoves] = useState<ValidMove[]>([]);
  const [logs, setLogs] = useState<MoveLogEntry[]>([]);

  // Bot Ready State (for online Bot vs Bot)
  const isBotMatch = session.mode === 'bot' && session.mySeat !== null;
  const [selectedBotSource, setSelectedBotSource] = useState<string>(
    hasSavedBot ? 'saved' : 'minimax'
  );
  const [myBotReady, setMyBotReady] = useState(!isBotMatch);
  const [peerBotReady, setPeerBotReady] = useState(!isBotMatch);
  const [loadingPyodide, setLoadingPyodide] = useState(false);
  const [botSecondsLeft, setBotSecondsLeft] = useState(BOT_TURN_TIMEOUT_MS / 1000);
  const [botThinking, setBotThinking] = useState(false);

  // Disconnect & Forfeit handling
  const [peerOffline, setPeerOffline] = useState(false);
  const [claimingWin, setClaimingWin] = useState(false);

  // Consensus Cryptographic State
  const identityRef = useRef<ConsensusIdentity | null>(null);
  const peerPubKeyRef = useRef<CryptoKey | null>(null);
  const [consensusReady, setConsensusReady] = useState(session.mySeat === null);
  const pendingPeerCommitRef = useRef<{ stepCount: number; hash: string; attestation: any } | null>(
    null
  );
  const replayMovesRef = useRef<any[]>([]);
  const myFinalProofRef = useRef<{ proof: any; signature: string } | null>(null);
  const peerFinalProofRef = useRef<{ proof: any; signature: string } | null>(null);
  const submittedResultRef = useRef(false);
  const botRunnerRef = useRef<BotRunner | null>(null);
  const steppingBotRef = useRef(false);

  // Post-match result summary
  const [resultSummary, setResultSummary] = useState<{
    eloBefore?: number;
    eloAfter?: number;
    eloUpdated?: boolean;
    tournamentUpdate?: { tier: string; stars: number; seasonPoints: number; phase: string } | null;
    verified?: boolean;
  } | null>(null);

  const sendMessageToPeer = useCallback(
    (payload: unknown) => {
      if (session.source === 'backend') {
        backendClient.sendPeerMessage(session.matchId, payload, Boolean(session.isSparring));
      } else if (session.p2pSend) {
        session.p2pSend(payload);
      }
    },
    [session]
  );

  // Submit result once both signed final proofs arrive
  const trySubmitBackendResult = useCallback(async () => {
    if (
      session.source !== 'backend' ||
      session.mySeat === null ||
      submittedResultRef.current ||
      !myFinalProofRef.current ||
      !peerFinalProofRef.current
    ) {
      return;
    }
    submittedResultRef.current = true;
    const p1Proof = session.mySeat === 1 ? myFinalProofRef.current : peerFinalProofRef.current;
    const p2Proof = session.mySeat === 2 ? myFinalProofRef.current : peerFinalProofRef.current;

    const replayPayload = {
      format: 'ottv2-replay-v1',
      matchId: session.matchId,
      seed: session.seed,
      initialState: initialSerializedRef.current,
      moves: replayMovesRef.current,
    };

    try {
      const res = await backendClient.submitMatchResult({
        matchId: session.matchId,
        proofs: { player1: p1Proof, player2: p2Proof },
        replay: replayPayload,
      });
      const myEloObj = session.mySeat === 1 ? res.elo?.player1 : res.elo?.player2;
      setResultSummary({
        eloBefore: myEloObj?.before,
        eloAfter: myEloObj?.after,
        eloUpdated: res.eloUpdated,
        tournamentUpdate: res.tournamentUpdate || null,
        verified: true,
      });
      notify('Kết quả trận đấu đã được xác minh chữ ký P-256 và lưu lên hệ thống!', 'success');
    } catch (err: any) {
      notify(err.message || 'Không thể gửi kết quả xác minh lên máy chủ.', 'error');
    }
  }, [notify, session]);

  const signAndBroadcastFinalProof = useCallback(
    async (finalState: GameState) => {
      if (
        !identityRef.current ||
        session.mySeat === null ||
        finalState.winner === null ||
        finalState.winner === undefined
      ) {
        return;
      }
      const stateHash = await hashState(finalState);
      const proof = {
        matchId: session.matchId,
        roomId: session.matchId,
        stepCount: finalState.stepCount,
        stateHash,
        winner: finalState.winner,
      };
      const signature = await signPayload(identityRef.current, proof);
      myFinalProofRef.current = { proof, signature };
      sendMessageToPeer({
        type: 'FINAL_PROOF',
        seat: session.mySeat,
        proof,
        signature,
      });
      await trySubmitBackendResult();
    },
    [sendMessageToPeer, session.matchId, session.mySeat, trySubmitBackendResult]
  );

  // Propose our own move (Human click or Local BotRunner output)
  const proposeMyMove = useCallback(
    async (move: { from: number; to: number }, elapsedMs?: number) => {
      const current = stateRef.current;
      if (
        !identityRef.current ||
        session.mySeat === null ||
        current.winner !== null ||
        current.turn !== session.mySeat
      ) {
        return;
      }

      const stepIdx = current.stepCount;
      const nonce = createNonce();
      const commit = await hashMove({
        matchId: session.matchId,
        stepCount: stepIdx,
        player: session.mySeat,
        move: { from: move.from, to: move.to },
        nonce,
      });

      const commitPayload = {
        kind: 'move-commit',
        matchId: session.matchId,
        stepCount: stepIdx,
        player: session.mySeat,
        hash: commit,
      };
      const commitSig = await signPayload(identityRef.current, commitPayload);
      sendMessageToPeer({
        type: 'CONSENSUS_COMMIT',
        attestation: { payload: commitPayload, signature: commitSig },
      });

      const revealPayload = {
        kind: 'move-reveal',
        matchId: session.matchId,
        stepCount: stepIdx,
        player: session.mySeat,
        move: { from: move.from, to: move.to },
        nonce,
        commit,
      };
      const revealSig = await signPayload(identityRef.current, revealPayload);

      const nextState = OTTGameEngine.applyMove(current, { from: move.from, to: move.to });
      const stateHash = await hashState(nextState);
      const ackPayload = {
        kind: 'state-ack',
        matchId: session.matchId,
        stepCount: nextState.stepCount,
        player: session.mySeat,
        moveCommit: commit,
        stateHash,
      };
      const ackSig = await signPayload(identityRef.current, ackPayload);

      replayMovesRef.current.push({
        stepCount: nextState.stepCount,
        player: session.mySeat,
        move: { from: move.from, to: move.to },
        nonce,
        commit,
        stateHash,
      });

      stateRef.current = nextState;
      setGameState(nextState);
      setSelectedCell(null);
      setValidMoves([]);

      if (nextState.lastMove?.isAttack) soundFx.playCapture();
      else soundFx.playMove();

      const pName = nextState.lastMove ? PIECE_VIET_NAMES[nextState.lastMove.piece] : 'Quân';
      setLogs((prev) => [
        ...prev,
        {
          step: nextState.stepCount,
          text: `P${session.mySeat} ${pName} ${OTTGameEngine.toAlgebraic(
            move.from
          )} → ${OTTGameEngine.toAlgebraic(move.to)}${
            nextState.lastMove?.isAttack ? ' · Ăn quân' : ''
          }`,
          isCapture: nextState.lastMove?.isAttack,
          elapsedMs,
        },
      ]);

      sendMessageToPeer({
        type: 'CONSENSUS_REVEAL',
        attestation: { payload: revealPayload, signature: revealSig },
      });
      sendMessageToPeer({
        type: 'CONSENSUS_ACK',
        attestation: { payload: ackPayload, signature: ackSig },
      });

      if (nextState.winner !== null) {
        if (nextState.winner === session.mySeat) soundFx.playVictory();
        else if (nextState.winner === 0) soundFx.playMove();
        else soundFx.playDefeat();
        await signAndBroadcastFinalProof(nextState);
      }
    },
    [sendMessageToPeer, session.matchId, session.mySeat, signAndBroadcastFinalProof]
  );

  // Claim Technical Win if opponent disconnects / abandons match
  const handleClaimDisconnect = async () => {
    if (session.source !== 'backend' || session.mySeat === null) return;
    try {
      setClaimingWin(true);
      const res = await backendClient.claimDisconnect(session.matchId);
      const myEloObj = session.mySeat === 1 ? res.elo?.player1 : res.elo?.player2;
      setResultSummary({
        eloBefore: myEloObj?.before,
        eloAfter: myEloObj?.after,
        eloUpdated: res.eloUpdated,
        tournamentUpdate: res.tournamentUpdate || null,
        verified: true,
      });
      setGameState((prev) => ({ ...prev, winner: session.mySeat }));
      notify(res.message || 'Xử thắng kỹ thuật thành công!', 'success');
      soundFx.playVictory();
    } catch (err: any) {
      notify(err.message || 'Không thể gửi yêu cầu xử thắng.', 'error');
    } finally {
      setClaimingWin(false);
    }
  };

  // Setup Consensus Identity & Peer Message Listener
  useEffect(() => {
    let active = true;
    let helloInterval: ReturnType<typeof setInterval> | null = null;

    (async () => {
      if (session.mySeat !== null) {
        const id = await generateIdentity();
        if (!active) return;
        identityRef.current = id;
        if (session.source === 'backend') {
          try {
            backendClient.registerSessionKey(session.matchId, id.publicJwk);
          } catch {
            // ignore if socket reconnecting
          }
        }
        const sendHello = () => {
          sendMessageToPeer({
            type: 'CONSENSUS_HELLO',
            seat: session.mySeat,
            publicKey: id.publicJwk,
            autoStart: !isBotMatch,
          });
        };
        sendHello();
        helloInterval = setInterval(() => {
          if (!peerPubKeyRef.current) sendHello();
          else if (helloInterval) clearInterval(helloInterval);
        }, 1200);
      }
    })();

    const handlePeerPacket = async (packet: any) => {
      if (!active || !packet) return;

      if (packet.type === 'PLAYER_DISCONNECTED' && session.mySeat !== null) {
        if (packet.seat !== 1 && packet.seat !== 2) return;
        const winner: GameState['winner'] = packet.seat === 1 ? 2 : 1;
        const finalState = { ...stateRef.current, winner };
        stateRef.current = finalState;
        setGameState(finalState);
        if (winner === session.mySeat) {
          notify('Đối thủ đã rời trận. Bạn thắng ván này!', 'success');
          soundFx.playVictory();
        } else {
          notify('Bạn đã mất kết nối với đối thủ và bị xử thua.', 'error');
          soundFx.playDefeat();
        }
        return;
      }

      if (packet.type === 'BOT_FORFEIT' && session.mySeat !== null) {
        if (packet.seat !== 1 && packet.seat !== 2) return;
        const winner: GameState['winner'] = packet.seat === 1 ? 2 : 1;
        const finalState = { ...stateRef.current, winner };
        stateRef.current = finalState;
        setGameState(finalState);
        notify(
          packet.seat === session.mySeat
            ? 'Bot của bạn gặp lỗi và bị xử thua kỹ thuật.'
            : 'Bot đối thủ gặp lỗi. Bạn thắng kỹ thuật!',
          winner === session.mySeat ? 'success' : 'error'
        );
        if (winner === session.mySeat) soundFx.playVictory();
        else soundFx.playDefeat();
        return;
      }

      if (packet.type === 'SPECTATE_SYNC' && packet.serializedState) {
        const synced = OTTGameEngine.deserialize(packet.serializedState);
        stateRef.current = synced;
        setGameState(synced);
        return;
      }

      if (packet.type === 'CONSENSUS_HELLO' && packet.publicKey && packet.seat !== session.mySeat) {
        if (!peerPubKeyRef.current) {
          peerPubKeyRef.current = await importPublicKey(packet.publicKey);
          setConsensusReady(true);
          setPeerOffline(false);
          if (identityRef.current && session.mySeat !== null) {
            sendMessageToPeer({
              type: 'CONSENSUS_HELLO',
              seat: session.mySeat,
              publicKey: identityRef.current.publicJwk,
              autoStart: false,
            });
          }
        }
        return;
      }

      if (packet.type === 'BOT_READY') {
        setPeerBotReady(true);
        setPeerOffline(false);
        return;
      }

      if (packet.type === 'BOT_SETUP_FAILED') {
        notify(packet.message || 'Trận bị hủy vì Bot của đối thủ không khởi động được.', 'error');
        onExit();
        return;
      }

      if (packet.type === 'CONSENSUS_COMMIT' && packet.attestation) {
        setPeerOffline(false);
        pendingPeerCommitRef.current = {
          stepCount: packet.attestation.payload?.stepCount,
          hash: packet.attestation.payload?.hash,
          attestation: packet.attestation,
        };
        return;
      }

      if (packet.type === 'CONSENSUS_REVEAL' && packet.attestation) {
        setPeerOffline(false);
        const payload = packet.attestation.payload;
        if (!payload || payload.player === session.mySeat) return;
        const curr = stateRef.current;
        if (payload.stepCount !== curr.stepCount) return;

        if (peerPubKeyRef.current) {
          const validSig = await verifyPayload(
            peerPubKeyRef.current,
            payload,
            packet.attestation.signature
          );
          if (!validSig) {
            notify('Phát hiện chữ ký nước đi không hợp lệ từ đối thủ!', 'error');
            return;
          }
        }

        const nextState = OTTGameEngine.applyMove(curr, {
          from: payload.move.from,
          to: payload.move.to,
        });
        const stateHash = await hashState(nextState);

        replayMovesRef.current.push({
          stepCount: nextState.stepCount,
          player: payload.player,
          move: { from: payload.move.from, to: payload.move.to },
          nonce: payload.nonce,
          commit: payload.commit,
          stateHash,
        });

        stateRef.current = nextState;
        setGameState(nextState);

        if (nextState.lastMove?.isAttack) soundFx.playCapture();
        else soundFx.playMove();

        const pName = nextState.lastMove ? PIECE_VIET_NAMES[nextState.lastMove.piece] : 'Quân';
        setLogs((prev) => [
          ...prev,
          {
            step: nextState.stepCount,
            text: `P${payload.player} ${pName} ${OTTGameEngine.toAlgebraic(
              payload.move.from
            )} → ${OTTGameEngine.toAlgebraic(payload.move.to)}${
              nextState.lastMove?.isAttack ? ' · Ăn quân' : ''
            }`,
            isCapture: nextState.lastMove?.isAttack,
          },
        ]);

        if (identityRef.current && session.mySeat !== null) {
          const ackPayload = {
            kind: 'state-ack',
            matchId: session.matchId,
            stepCount: nextState.stepCount,
            player: session.mySeat,
            moveCommit: payload.commit,
            stateHash,
          };
          const ackSig = await signPayload(identityRef.current, ackPayload);
          sendMessageToPeer({
            type: 'CONSENSUS_ACK',
            attestation: { payload: ackPayload, signature: ackSig },
          });
        }

        if (nextState.winner !== null) {
          if (nextState.winner === session.mySeat) soundFx.playVictory();
          else if (nextState.winner === 0) soundFx.playMove();
          else soundFx.playDefeat();
          await signAndBroadcastFinalProof(nextState);
        }
        return;
      }

      if (packet.type === 'FINAL_PROOF' && packet.seat !== session.mySeat) {
        peerFinalProofRef.current = { proof: packet.proof, signature: packet.signature };
        await trySubmitBackendResult();
        return;
      }

      if (packet.type === 'peer-disconnected' && packet.matchId === session.matchId) {
        notify('Đối thủ đã rời trận. Nếu không quay lại trong 10 giây, bạn sẽ được xử thắng.', 'info');
        return;
      }

      if (packet.type === 'match-forfeited' && packet.matchId === session.matchId) {
        const winner = packet.winnerPlayer === 1 || packet.winnerPlayer === 2
          ? packet.winnerPlayer
          : null;
        if (!winner) return;
        const forfeitedState = { ...stateRef.current, winner, turn: winner };
        stateRef.current = forfeitedState;
        setGameState(forfeitedState);
        setResultSummary({
          eloAfter: packet.eloAfter,
          eloUpdated: Boolean(packet.eloUpdated),
          verified: true,
        });
        if (winner === session.mySeat) soundFx.playVictory();
        else soundFx.playDefeat();
        notify(packet.message || 'Trận đấu đã kết thúc do đối thủ rời phòng quá lâu.', winner === session.mySeat ? 'success' : 'error');
      }
    };

    const unsub =
      session.source === 'backend'
        ? backendClient.on('peer-data', handlePeerPacket)
        : session.subscribePeerData
        ? session.subscribePeerData(handlePeerPacket)
        : () => {};
    const unsubDisconnect =
      session.source === 'backend'
        ? backendClient.on('peer-disconnected', handlePeerPacket)
        : () => {};
    const unsubForfeited =
      session.source === 'backend'
        ? backendClient.on('match-forfeited', handlePeerPacket)
        : () => {};

    const unsubAborted =
      session.source === 'backend'
        ? backendClient.on('match-aborted', (pkt) => {
            notify(pkt.message || 'Trận đấu đã bị hủy.', 'error');
            onExit();
          })
        : () => {};

    const unsubPeerOffline =
      session.source === 'backend'
        ? backendClient.on('peer-offline', (pkt) => {
            if (pkt.matchId === session.matchId) {
              setPeerOffline(true);
              notify('Đối thủ đã mất kết nối hoặc rời trận!', 'info');
            }
          })
        : () => {};

    const unsubForfeitWin =
      session.source === 'backend'
        ? backendClient.on('match-forfeited-win', (pkt) => {
            if (pkt.matchId === session.matchId) {
              notify(pkt.message || 'Đối thủ bị xử thua kỹ thuật. Bạn giành chiến thắng!', 'success');
              soundFx.playVictory();
              setGameState((prev) => ({ ...prev, winner: session.mySeat }));
              setResultSummary((prev) => ({
                ...prev,
                verified: true,
              }));
            }
          })
        : () => {};

    const unsubForfeitLoss =
      session.source === 'backend'
        ? backendClient.on('match-forfeited-loss', (pkt) => {
            if (pkt.matchId === session.matchId) {
              notify(pkt.message || 'Bạn bị xử thua kỹ thuật!', 'error');
              soundFx.playDefeat();
              setGameState((prev) => ({ ...prev, winner: session.mySeat === 1 ? 2 : 1 }));
              setResultSummary((prev) => ({
                ...prev,
                verified: true,
              }));
            }
          })
        : () => {};

    return () => {
      active = false;
      if (helloInterval) clearInterval(helloInterval);
      unsub();
      unsubDisconnect();
      unsubForfeited();
      unsubAborted();
      unsubPeerOffline();
      unsubForfeitWin();
      unsubForfeitLoss();
      botRunnerRef.current?.destroy();
    };
  }, [
    isBotMatch,
    notify,
    onExit,
    sendMessageToPeer,
    session,
    signAndBroadcastFinalProof,
    trySubmitBackendResult,
  ]);

  // Start a visible turn clock for both players, and enforce it on the active bot.
  useEffect(() => {
    if (
      !isBotMatch ||
      !myBotReady ||
      !peerBotReady ||
      !consensusReady ||
      gameState.winner !== null
    ) {
      setBotThinking(false);
      return;
    }

    const deadline = Date.now() + BOT_TURN_TIMEOUT_MS;
    let expired = false;
    setBotSecondsLeft(BOT_TURN_TIMEOUT_MS / 1000);
    setBotThinking(true);
    const countdown = setInterval(() => {
      setBotSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 100);

    const forfeit = (message: string) => {
      if (expired) return;
      if (stateRef.current.winner !== null || stateRef.current.turn !== session.mySeat) return;
      expired = true;
      try {
        if (session.source === 'backend') {
          backendClient.botForfeit(session.matchId, message);
        } else if (session.mySeat !== null) {
          sendMessageToPeer({ type: 'BOT_FORFEIT', seat: session.mySeat, message });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Lỗi kết nối không xác định.';
        notify(`Không gửi được kết quả xử thua lên máy chủ: ${detail}`, 'error');
      }
      const winner: GameState['winner'] = session.mySeat === 1 ? 2 : 1;
      const forfeitedState = { ...stateRef.current, winner };
      stateRef.current = forfeitedState;
      setGameState(forfeitedState);
      setBotThinking(false);
      notify(`Hết 5 giây: Bot bị xử thua kỹ thuật. ${message}`, 'error');
      soundFx.playDefeat();
    };

    let moveTimeout: ReturnType<typeof setTimeout> | undefined;
    if (gameState.turn === session.mySeat && !steppingBotRef.current) {
      steppingBotRef.current = true;
      const timeout = new Promise<never>((_, reject) => {
        moveTimeout = setTimeout(() => {
          botRunnerRef.current?.destroy();
          reject(new Error('Bot vượt quá giới hạn 5 giây.'));
        }, Math.max(0, deadline - Date.now()));
      });

      Promise.race([
        (async () => {
          const curr = stateRef.current;
          const runner = botRunnerRef.current;
          if (
            curr.winner !== null ||
            curr.turn !== session.mySeat ||
            !runner?.ready
          ) {
            throw new Error('Bot chưa sẵn sàng khi bắt đầu lượt.');
          }
          const botState = OTTGameEngine.createBotGameState(curr, session.mySeat);
          const moveRes = await runner.getMove(session.mySeat, botState);
          steppingBotRef.current = false;
          await proposeMyMove({ from: moveRes.from, to: moveRes.to }, moveRes.elapsedMs);
          if (stateRef.current.stepCount === curr.stepCount && stateRef.current.winner === null) {
            throw new Error('Nước đi Bot không được áp dụng trước khi hết lượt.');
          }
        })(),
        timeout,
      ]).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Bot không trả về nước đi hợp lệ.';
        forfeit(message);
      }).finally(() => {
        if (moveTimeout) clearTimeout(moveTimeout);
      });
    }

    return () => {
      clearInterval(countdown);
      if (moveTimeout) clearTimeout(moveTimeout);
      steppingBotRef.current = false;
    };
  }, [
    consensusReady,
    gameState,
    isBotMatch,
    myBotReady,
    notify,
    peerBotReady,
    proposeMyMove,
    session.matchId,
    session.mySeat,
    session.source,
    sendMessageToPeer,
  ]);

  const handleConfirmBotReady = async () => {
    setLoadingPyodide(true);
    try {
      let code = '';
      if (selectedBotSource === 'saved') {
        code = savedBotCode;
      } else if (selectedBotSource === 'custom') {
        code = customEditorCode;
      } else {
        code = SAMPLE_BOTS[selectedBotSource as SampleBotKey] || SAMPLE_BOTS.minimax;
      }
      if (!code.trim()) {
        throw new Error('Không tìm thấy mã nguồn Python cho lựa chọn này.');
      }

      const runner = new BotRunner('MatchBot', BOT_TURN_TIMEOUT_MS);
      await runner.loadBot(code, selectedBotSource);
      botRunnerRef.current = runner;
      setMyBotReady(true);
      sendMessageToPeer({ type: 'BOT_READY' });
      notify('Đã nạp Bot Python thành công! Đang đồng bộ khai cuộc…', 'success');
    } catch (err: any) {
      notify(err.message || 'Không thể khởi tạo Bot Python.', 'error');
      if (session.source === 'backend') {
        backendClient.abortBotSetup(session.matchId, err.message || 'Không thể khởi tạo Bot Python.');
      } else {
        sendMessageToPeer({
          type: 'BOT_SETUP_FAILED',
          message: 'Trận bị hủy vì Bot của một người chơi không khởi động được.',
        });
        onExit();
      }
    } finally {
      setLoadingPyodide(false);
    }
  };

  const handleBoardClick = (index: number) => {
    if (
      session.mySeat === null ||
      session.mode === 'bot' ||
      !consensusReady ||
      gameState.winner !== null ||
      gameState.turn !== session.mySeat
    ) {
      return;
    }

    if (selectedCell !== null) {
      const candidate = validMoves.find((m) => m.to === index);
      if (candidate) {
        proposeMyMove({ from: candidate.from, to: candidate.to });
        return;
      }
    }

    const piece = gameState.board[index];
    const owner = piece ? (piece <= 3 ? 1 : 2) : null;
    if (owner === session.mySeat) {
      soundFx.playSelect();
      setSelectedCell(index);
      setValidMoves(OTTGameEngine.getValidMoves(gameState, index));
    } else {
      setSelectedCell(null);
      setValidMoves([]);
    }
  };

  const counts = OTTGameEngine.countPieces(gameState.board);
  const isMyTurn = session.mySeat !== null && gameState.turn === session.mySeat && gameState.winner === null;

  const exportCurrentReplay = () => {
    const replayPayload = {
      format: 'ottv2-replay-v1',
      matchId: session.matchId,
      seed: session.seed,
      initialState: initialSerializedRef.current,
      moves: replayMovesRef.current,
    };
    onOpenReplay(replayPayload, session.player1Name, session.player2Name);
  };

  const downloadReplayFile = () => {
    const replayPayload = {
      format: 'ottv2-replay-v1',
      matchId: session.matchId,
      seed: session.seed,
      initialState: initialSerializedRef.current,
      moves: replayMovesRef.current,
    };
    const blob = new Blob([JSON.stringify(replayPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ottv2-match-${session.matchId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Top Match Control Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Rời bàn đấu
          </button>
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
              <Swords className="w-4 h-4 text-[var(--accent-primary)]" />
              <span>
                {session.mySeat === null
                  ? 'Chế độ Khán giả Trực tiếp'
                  : session.mode === 'bot'
                  ? 'Đấu Trường Bot vs Bot'
                  : 'Đối Kháng Trực Tiếp 1v1'}
              </span>
            </div>
            <div className="text-xs text-[var(--text-secondary)] tabular-nums">
              {session.rules?.title || 'Bàn chuẩn 9×9'} · Seed {session.seed}
              {session.roomCode ? ` · Mã phòng: ${session.roomCode}` : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {session.roomCode && (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(session.roomCode!);
                notify(`Đã sao chép mã phòng ${session.roomCode}`, 'success');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
              {session.roomCode}
            </button>
          )}
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <ShieldCheck
              className={`w-4 h-4 ${consensusReady ? 'text-emerald-400' : 'text-amber-400'}`}
            />
            <span>{consensusReady ? 'Đồng thuận P-256 sẵn sàng' : 'Đang bắt tay khóa phiên…'}</span>
          </div>
        </div>
      </div>

      {/* Peer Disconnected Alert Banner */}
      {peerOffline && gameState.winner === null && session.source === 'backend' && session.mySeat !== null && (
        <div className="p-4 rounded-2xl border border-amber-500/40 bg-amber-950/25 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-amber-200">
            <WifiOff className="w-4 h-4 text-amber-400" />
            <span>Đối thủ đã mất kết nối hoặc đóng trình duyệt. Bạn có thể yêu cầu Xử Thắng Kỹ Thuật ngay lập tức.</span>
          </div>
          <button
            type="button"
            disabled={claimingWin}
            onClick={handleClaimDisconnect}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {claimingWin ? 'Đang gửi yêu cầu…' : 'Yêu cầu Xử Thắng (Rage Quit)'}
          </button>
        </div>
      )}

      {/* Bot Ready Selection Banner (for Bot vs Bot before start) */}
      {isBotMatch && (!myBotReady || !peerBotReady) && (
        <div className="p-5 rounded-2xl border border-[var(--border-accent)] bg-[var(--bg-panel)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Bot className="w-5 h-5 text-[var(--accent-primary)]" />
              Chọn Bot Python xuất trận
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              {myBotReady
                ? 'Bot của bạn đã nạp xong. Đang chờ đối thủ bấm Sẵn sàng…'
                : 'Chọn phiên bản Bot đã lưu hoặc sử dụng ngay một trong các Bot chiến thuật mẫu bên dưới.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <select
              disabled={myBotReady || loadingPyodide}
              value={selectedBotSource}
              onChange={(e) => setSelectedBotSource(e.target.value)}
              aria-label="Chọn Bot xuất trận"
              className="px-3.5 py-2.5 text-xs font-medium rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
            >
              {hasSavedBot && <option value="saved">Bot đã lưu trên tài khoản</option>}
              <option value="phantom_hunter">Bot mẫu · Phantom Hunter (Halloween)</option>
              <option value="minimax">Bot mẫu · Minimax Tactical</option>
              <option value="greedy">Bot mẫu · Greedy AI</option>
              <option value="random">Bot mẫu · Random Bot</option>
              {customEditorCode.trim() && (
                <option value="custom">Code đang mở trong Phòng Lab</option>
              )}
            </select>

            <button
              type="button"
              disabled={myBotReady || loadingPyodide || !consensusReady}
              onClick={handleConfirmBotReady}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              {loadingPyodide ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang nạp Python…
                </>
              ) : myBotReady ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Đã sẵn sàng
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Sẵn sàng khai cuộc
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Main Clean 1v1 Layout: Board Center + Match Log Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-4">
          {/* Dual Player HUD */}
          <div className="grid grid-cols-1 sm:grid-cols-11 gap-3 items-center p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
            {/* Player 1 */}
            <div
              className={`sm:col-span-5 p-3 rounded-xl border transition-colors ${
                gameState.turn === 1 && gameState.winner === null
                  ? 'border-[var(--p1-border)] bg-[var(--p1-bg)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[var(--p1-main)] truncate">
                  {session.player1Name} {session.mySeat === 1 ? '(Bạn)' : ''}
                </span>
                {session.player1Elo && (
                  <span className="text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                    {session.player1Elo} Elo
                  </span>
                )}
              </div>
              <div className="mt-1.5">
                <MascotCountsInline counts={counts[1]} team={1} />
              </div>
            </div>

            {/* Turn Center Indicator */}
            <div className="sm:col-span-1 flex flex-col items-center justify-center text-center">
              <span className="text-xs font-mono font-bold text-[var(--text-muted)]">VS</span>
              <span className="text-[11px] font-mono text-[var(--accent-primary)] tabular-nums">
                #{gameState.stepCount}
              </span>
            </div>

            {/* Player 2 */}
            <div
              className={`sm:col-span-5 p-3 rounded-xl border transition-colors ${
                gameState.turn === 2 && gameState.winner === null
                  ? 'border-[var(--p2-border)] bg-[var(--p2-bg)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[var(--p2-main)] truncate">
                  {session.player2Name} {session.mySeat === 2 ? '(Bạn)' : ''}
                </span>
                {session.player2Elo && (
                  <span className="text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                    {session.player2Elo} Elo
                  </span>
                )}
              </div>
              <div className="mt-1.5">
                <MascotCountsInline counts={counts[2]} team={2} />
              </div>
            </div>
          </div>

          {/* Turn Banner / Victory / Draw Banner */}
          {gameState.winner !== null ? (
            <div
              className={`p-5 rounded-2xl border flex flex-wrap items-center justify-between gap-4 ${
                gameState.winner === 0
                  ? 'border-amber-500/40 bg-amber-950/25'
                  : 'border-emerald-500/40 bg-emerald-950/25'
              }`}
            >
              <div>
                <h3
                  className={`text-lg font-bold ${
                    gameState.winner === 0 ? 'text-amber-300' : 'text-emerald-300'
                  }`}
                >
                  {gameState.winner === 0
                    ? 'Ván cờ Hòa! (Lặp lại 3 lần, 50 nước không ăn quân, hết nước đi hoặc đạt mốc 180 lượt)'
                    : session.mySeat === null
                    ? `${gameState.winner === 1 ? session.player1Name : session.player2Name} giành chiến thắng!`
                    : gameState.winner === session.mySeat
                    ? 'Chiến thắng thuyết phục!'
                    : 'Trận đấu khép lại — Đối thủ thắng!'}
                </h3>
                <div className="text-xs text-[var(--text-secondary)] mt-1 tabular-nums">
                  Hoàn tất sau {gameState.stepCount} nước đi
                  {resultSummary?.eloUpdated &&
                    resultSummary.eloBefore !== undefined &&
                    resultSummary.eloAfter !== undefined && (
                      <>
                        {' · '}Elo: {resultSummary.eloBefore} →{' '}
                        <strong className="text-[var(--text-primary)]">{resultSummary.eloAfter}</strong> (
                        {resultSummary.eloAfter - resultSummary.eloBefore >= 0 ? '+' : ''}
                        {resultSummary.eloAfter - resultSummary.eloBefore})
                      </>
                    )}
                  {resultSummary?.tournamentUpdate && (
                    <>
                      {' · '}Hạng giải: {resultSummary.tournamentUpdate.tier} (
                      {resultSummary.tournamentUpdate.stars} Sao)
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                {gameState.stepCount > 0 && (
                  <button
                    type="button"
                    onClick={exportCurrentReplay}
                    className="px-4 py-2 rounded-xl text-xs font-semibold border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] cursor-pointer"
                  >
                    Xem lại Replay
                  </button>
                )}
                {session.source === 'p2p' && session.isHost && session.onHostResetRoom && (
                  <button
                    type="button"
                    onClick={session.onHostResetRoom}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Ván mới
                  </button>
                )}
                <button
                  type="button"
                  onClick={onExit}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] cursor-pointer"
                >
                  Về sảnh
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs">
              <span className="font-semibold text-[var(--text-primary)]">
                {session.mySeat === null
                  ? `Đang tới lượt: ${gameState.turn === 1 ? session.player1Name : session.player2Name}`
                  : isBotMatch && botThinking
                  ? gameState.turn === session.mySeat
                    ? `Bot của bạn đang tính toán… còn ${botSecondsLeft} giây`
                    : `Bot đối thủ đang tính toán… còn ${botSecondsLeft} giây`
                  : isMyTurn
                  ? session.mode === 'bot'
                    ? 'Bot đang chuẩn bị tính toán nước đi…'
                    : 'Lượt của bạn — Hãy chọn quân cờ để di chuyển'
                  : 'Đang chờ nước đi của đối thủ…'}
              </span>
              {session.source === 'backend' && session.mySeat !== null && !peerOffline && (
                <button
                  type="button"
                  onClick={handleClaimDisconnect}
                  title="Nếu đối thủ cố tình đóng trình duyệt hoặc bỏ chạy, bấm để hệ thống kiểm tra và xử thắng ngay"
                  className="text-[11px] text-[var(--text-secondary)] hover:text-amber-400 underline ml-2 cursor-pointer"
                >
                  Đối thủ bỏ chạy?
                </button>
              )}
              <span className="text-[var(--text-secondary)] hidden sm:inline">
                Bí Ngô (Đấm) ăn Dơi (Kéo) · Dơi ăn Bé Ma (Lá) · Bé Ma ăn Bí Ngô
              </span>
            </div>
          )}

          {/* Focused 9x9 Tactical Board */}
          <div className="p-4 sm:p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
            <Board9x9
              state={gameState}
              selectedCell={selectedCell}
              validMoves={validMoves}
              onCellClick={handleBoardClick}
              interactive={isMyTurn && session.mode === 'human'}
              size="large"
              themeMode={themeMode}
            />
          </div>
        </div>

        {/* Right Column: Clean Algebraic Move Log & Rules Legend */}
        <div className="lg:col-span-4 space-y-4">
          <div className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-col h-[460px]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Nhật ký nước đi</h3>
              {logs.length > 0 && (
                <button
                  type="button"
                  onClick={downloadReplayFile}
                  className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Lưu JSON
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto mt-3 space-y-1.5 pr-1">
              {logs.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] py-8 text-center">
                  Chưa có nước đi nào được thực hiện.
                </p>
              ) : (
                logs.map((entry) => (
                  <div
                    key={entry.step}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-canvas)] text-xs font-mono tabular-nums"
                  >
                    <span className={entry.isCapture ? 'text-amber-300 font-medium' : 'text-[var(--text-primary)]'}>
                      #{String(entry.step).padStart(2, '0')} {entry.text}
                    </span>
                    {entry.elapsedMs !== undefined && (
                      <span className="text-[var(--text-muted)]">{entry.elapsedMs}ms</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-2 text-xs text-[var(--text-secondary)]">
            <h4 className="font-bold text-[var(--text-primary)]">Quy tắc thắng nhanh OTTv2</h4>
            <p>1. Phe 1 đưa quân vào căn cứ Phe 2 (i9), hoặc Phe 2 đưa quân vào căn cứ Phe 1 (a1) để thắng ngay.</p>
            <p>
              2. Hoặc tiêu diệt toàn bộ 1 trong 3 hệ linh vật (Bí Ngô - Đấm, Bé Ma - Lá hoặc Dơi - Kéo) của đối phương.
            </p>
            <p>
              3. Hòa cờ khi một thế cờ lặp lại 3 lần, 50 nước liên tiếp không ăn quân, đối thủ hết nước đi hợp lệ hoặc ván đấu chạm mốc 180 lượt.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
