/**
 * components/PaymentBuilder.tsx
 * Drag-and-drop payment builder interface for constructing batch payments.
 *
 * Supports:
 * - Drag-and-drop reordering of recipients
 * - Drag-and-drop token and amount assignment from QuickAdd panel
 * - Undo/redo (Ctrl+Z / Ctrl+Shift+Z)
 * - Keyboard accessibility (Space to pick, arrows to move, Space to drop)
 * - Screen reader announcements for reorder and modification operations
 */

import { motion, Reorder } from "framer-motion";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { isValidStellarAddress } from "@/lib/stellar";

export type TokenInfo = {
  code: string;
  issuer?: string;
};

export type BuilderRecipient = {
  id: string;
  address: string;
  amount: string;
  memo: string;
  token: TokenInfo;
};

type BuilderAction =
  | { type: "ADD_RECIPIENT" }
  | { type: "REMOVE_RECIPIENT"; id: string }
  | { type: "UPDATE_RECIPIENT"; id: string; updates: Partial<BuilderRecipient> }
  | { type: "REORDER"; recipients: BuilderRecipient[] }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_RECIPIENTS"; recipients: BuilderRecipient[] };

interface HistoryState {
  past: BuilderRecipient[][];
  present: BuilderRecipient[];
  future: BuilderRecipient[][];
}

const AVAILABLE_TOKENS: TokenInfo[] = [
  { code: "XLM" },
  { code: "USDC", issuer: "GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B" },
];

const MAX_RECIPIENTS = 10;

function createRecipient(): BuilderRecipient {
  return {
    id: `recipient-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    address: "",
    amount: "",
    memo: "",
    token: AVAILABLE_TOKENS[0],
  };
}

function builderReducer(state: HistoryState, action: BuilderAction): HistoryState {
  const pushHistory = (newPresent: BuilderRecipient[]) => ({
    past: [...state.past, state.present],
    present: newPresent,
    future: [],
  });

  switch (action.type) {
    case "ADD_RECIPIENT": {
      if (state.present.length >= MAX_RECIPIENTS) return state;
      return pushHistory([...state.present, createRecipient()]);
    }
    case "REMOVE_RECIPIENT": {
      if (state.present.length <= 1) return state;
      return pushHistory(state.present.filter((r) => r.id !== action.id));
    }
    case "UPDATE_RECIPIENT": {
      return pushHistory(
        state.present.map((r) =>
          r.id === action.id ? { ...r, ...action.updates } : r
        )
      );
    }
    case "REORDER": {
      return pushHistory(action.recipients);
    }
    case "SET_RECIPIENTS": {
      return pushHistory(action.recipients);
    }
    case "UNDO": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
      };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      };
    }
    default:
      return state;
  }
}

interface PaymentBuilderProps {
  publicKey?: string;
  initialRecipients?: BuilderRecipient[];
  onRecipientsChange?: (recipients: BuilderRecipient[]) => void;
}

export default function PaymentBuilder({
  publicKey,
  initialRecipients,
  onRecipientsChange,
}: PaymentBuilderProps) {
  const [state, dispatch] = useReducer(builderReducer, {
    past: [],
    present: initialRecipients && initialRecipients.length > 0 ? initialRecipients : [createRecipient()],
    future: [],
  });

  const [_dragIndex, setDragIndex] = useState<number | null>(null);
  const [pickedUpIndex, setPickedUpIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [liveRegion, setLiveRegion] = useState("");
  const announcerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragHandleRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { present: recipients } = state;
  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  // Notify parent of changes
  useEffect(() => {
    onRecipientsChange?.(recipients);
  }, [recipients, onRecipientsChange]);

  const announce = useCallback((message: string) => {
    setLiveRegion(message);
    if (announcerTimeoutRef.current) clearTimeout(announcerTimeoutRef.current);
    announcerTimeoutRef.current = setTimeout(() => setLiveRegion(""), 3000);
  }, []);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) {
            dispatch({ type: "REDO" });
            announce("Redo");
          }
        } else {
          if (canUndo) {
            dispatch({ type: "UNDO" });
            announce("Undo");
          }
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        if (canRedo) {
          dispatch({ type: "REDO" });
          announce("Redo");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, canRedo, announce]);

  const handleAddRecipient = () => {
    if (recipients.length >= MAX_RECIPIENTS) return;
    dispatch({ type: "ADD_RECIPIENT" });
    announce(`Recipient added. ${recipients.length + 1} total.`);
  };

  const handleRemoveRecipient = (id: string) => {
    const index = recipients.findIndex((r) => r.id === id);
    dispatch({ type: "REMOVE_RECIPIENT", id });
    announce(`Recipient ${index + 1} removed.`);
  };

  const handleUpdate = (id: string, updates: Partial<BuilderRecipient>) => {
    dispatch({ type: "UPDATE_RECIPIENT", id, updates });
  };

  const handleReorder = (reordered: BuilderRecipient[]) => {
    dispatch({ type: "REORDER", recipients: reordered });
    announce("Recipients reordered.");
  };

  const handleSetToken = (id: string, token: TokenInfo) => {
    handleUpdate(id, { token });
  };

  const handleSetAmount = (id: string, amount: string) => {
    handleUpdate(id, { amount });
  };

  const handleDragHandleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (pickedUpIndex === null) {
        setPickedUpIndex(index);
        announce(
          `Recipient ${index + 1} picked up. Press Up or Down arrow key to move, Space to drop, or Escape to cancel.`
        );
      } else {
        setPickedUpIndex(null);
        announce(`Recipient dropped at position ${index + 1}.`);
      }
    } else if (pickedUpIndex !== null) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (index > 0) {
          const next = [...recipients];
          const [item] = next.splice(index, 1);
          next.splice(index - 1, 0, item);
          handleReorder(next);
          setPickedUpIndex(index - 1);
          announce(`Recipient moved up to position ${index}.`);
          setTimeout(() => {
            dragHandleRefs.current[index - 1]?.focus();
          }, 0);
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (index < recipients.length - 1) {
          const next = [...recipients];
          const [item] = next.splice(index, 1);
          next.splice(index + 1, 0, item);
          handleReorder(next);
          setPickedUpIndex(index + 1);
          announce(`Recipient moved down to position ${index + 2}.`);
          setTimeout(() => {
            dragHandleRefs.current[index + 1]?.focus();
          }, 0);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPickedUpIndex(null);
        announce("Reordering cancelled.");
      }
    }
  };

  const handleDragOverRow = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (dropTargetIndex !== index) {
      setDropTargetIndex(index);
    }
  };

  const handleDragLeaveRow = (_e: React.DragEvent, index: number) => {
    if (dropTargetIndex === index) {
      setDropTargetIndex(null);
    }
  };

  const handleDropOnRow = (e: React.DragEvent, recipientId: string, index: number) => {
    e.preventDefault();
    setDropTargetIndex(null);
    try {
      const rawData =
        e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
      if (!rawData) return;
      const data = JSON.parse(rawData);
      if (data.type === "token") {
        const token =
          AVAILABLE_TOKENS.find((t) => t.code === data.value) || { code: data.value };
        handleSetToken(recipientId, token);
        announce(`Token for recipient ${index + 1} set to ${data.value}.`);
      } else if (data.type === "amount") {
        handleSetAmount(recipientId, data.value);
        announce(`Amount for recipient ${index + 1} set to ${data.value}.`);
      }
    } catch {
      // ignore invalid drag payloads
    }
  };

  const isValidAddress = (addr: string) => {
    if (!addr) return true;
    if (publicKey && addr === publicKey) return false;
    return isValidStellarAddress(addr);
  };

  return (
    <div className="space-y-4">
      {/* Screen reader live region */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveRegion}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "UNDO" });
              announce("Undo");
            }}
            disabled={!canUndo}
            className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            ↩ Undo
          </button>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "REDO" });
              announce("Redo");
            }}
            disabled={!canRedo}
            className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            ↪ Redo
          </button>
        </div>
        <span className="text-xs text-slate-400">
          {recipients.length} / {MAX_RECIPIENTS} recipients
        </span>
      </div>

      {/* Recipient list — drag-and-drop reorderable */}
      <Reorder.Group
        axis="y"
        values={recipients}
        onReorder={handleReorder}
        className="space-y-3"
      >
        {recipients.map((recipient, index) => {
          const isDropActive = dropTargetIndex === index;
          const isPickedUp = pickedUpIndex === index;

          return (
            <Reorder.Item
              key={recipient.id}
              value={recipient}
              className={`rounded-2xl border transition-colors p-4 ${
                isDropActive
                  ? "border-stellar-400 bg-stellar-500/10 shadow-lg shadow-stellar-500/10"
                  : isPickedUp
                    ? "border-stellar-500 bg-white/10 ring-2 ring-stellar-400"
                    : "border-white/10 bg-white/5"
              }`}
              whileDrag={{ scale: 1.02, boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => {
                setDragIndex(null);
                announce(`Recipient moved to position ${index + 1}.`);
              }}
              onDragOver={(e) => handleDragOverRow(e, index)}
              onDragLeave={(e) => handleDragLeaveRow(e, index)}
              onDrop={(e) => handleDropOnRow(e, recipient.id, index)}
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-400">
                      Recipient {index + 1}
                    </span>
                    {isPickedUp && (
                      <span className="rounded-full bg-stellar-500/20 px-2 py-0.5 text-[10px] font-semibold text-stellar-300">
                        Moving (Use Arrow Keys)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => handleRemoveRecipient(recipient.id)}
                      disabled={recipients.length <= 1}
                      className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-30 transition-colors"
                      aria-label={`Remove recipient ${index + 1}`}
                    >
                      ✕ Remove
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-4 items-center">
                  {/* Drag handle */}
                  <div
                    ref={(el) => {
                      dragHandleRefs.current[index] = el;
                    }}
                    className={`flex items-center justify-center p-2 rounded-lg cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-200 transition-colors focus:outline-none focus:ring-2 focus:ring-stellar-400 ${
                      isPickedUp ? "bg-stellar-500/20 text-stellar-300" : ""
                    }`}
                    aria-label={`Drag to reorder recipient ${index + 1}`}
                    aria-pressed={isPickedUp}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => handleDragHandleKeyDown(e, index)}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <circle cx="7" cy="5" r="1.5" />
                      <circle cx="13" cy="5" r="1.5" />
                      <circle cx="7" cy="10" r="1.5" />
                      <circle cx="13" cy="10" r="1.5" />
                      <circle cx="7" cy="15" r="1.5" />
                      <circle cx="13" cy="15" r="1.5" />
                    </svg>
                  </div>

                  {/* Token selector */}
                  <select
                    value={recipient.token.code}
                    onChange={(e) => {
                      const token = AVAILABLE_TOKENS.find((t) => t.code === e.target.value);
                      if (token) handleSetToken(recipient.id, token);
                    }}
                    className="input-field w-full text-sm"
                    aria-label={`Token for recipient ${index + 1}`}
                  >
                    {AVAILABLE_TOKENS.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.code}
                      </option>
                    ))}
                  </select>

                  {/* Address input */}
                  <input
                    type="text"
                    value={recipient.address}
                    onChange={(e) => handleUpdate(recipient.id, { address: e.target.value })}
                    placeholder="G..."
                    className={`input-field w-full text-sm ${
                      recipient.address && !isValidAddress(recipient.address)
                        ? "border-rose-500/50 focus:border-rose-500"
                        : ""
                    }`}
                    aria-label={`Address for recipient ${index + 1}`}
                    tabIndex={0}
                  />

                  {/* Amount input */}
                  <input
                    type="number"
                    step="0.0000001"
                    min="0"
                    value={recipient.amount}
                    onChange={(e) => handleSetAmount(recipient.id, e.target.value)}
                    placeholder="0.00"
                    className="input-field w-full text-sm"
                    aria-label={`Amount for recipient ${index + 1}`}
                  />
                </div>

                {/* Memo */}
                <input
                  type="text"
                  value={recipient.memo}
                  onChange={(e) => handleUpdate(recipient.id, { memo: e.target.value.slice(0, 28) })}
                  placeholder="Memo (optional)"
                  maxLength={28}
                  className="input-field w-full text-sm"
                  aria-label={`Memo for recipient ${index + 1}`}
                />
              </div>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>

      {/* Add recipient button */}
      <motion.button
        type="button"
        onClick={handleAddRecipient}
        disabled={recipients.length >= MAX_RECIPIENTS}
        className="btn-secondary w-full py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
        whileHover={recipients.length < MAX_RECIPIENTS ? { scale: 1.01 } : {}}
        whileTap={recipients.length < MAX_RECIPIENTS ? { scale: 0.99 } : {}}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        + Add recipient
      </motion.button>
    </div>
  );
}
