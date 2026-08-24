/**
 * components/TransactionAnnotations.tsx
 * Inline note field, tag chips, and bookmark star for transaction annotations.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  getAnnotation,
  setNote,
  toggleBookmark,
  addTag,
  removeTag,
  type TransactionAnnotation,
} from "@/lib/transactionAnnotations";
import { StarIcon, PencilIcon, XIcon } from "@/components/icons";
import clsx from "clsx";

interface TransactionAnnotationsProps {
  txId: string;
  /** Compact mode (for list rows) vs full mode (for detail page) */
  compact?: boolean;
}

export default function TransactionAnnotations({
  txId,
  compact = true,
}: TransactionAnnotationsProps) {
  const [annotation, setAnnotation] = useState<TransactionAnnotation | undefined>();
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [newTag, setNewTag] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Load annotation state
  const refresh = useCallback(() => {
    setAnnotation(getAnnotation(txId));
  }, [txId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingNote && noteInputRef.current) {
      noteInputRef.current.focus();
    }
  }, [isEditingNote]);

  useEffect(() => {
    if (showTagInput && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [showTagInput]);

  // Close editor when tapping outside (compact expand mode)
  useEffect(() => {
    if (!editorOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (editorRef.current && !editorRef.current.contains(e.target as Node)) {
        setEditorOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [editorOpen]);

  const handleToggleBookmark = () => {
    toggleBookmark(txId);
    refresh();
  };

  const handleStartNote = () => {
    setNoteText(annotation?.note ?? "");
    setIsEditingNote(true);
  };

  const handleSaveNote = () => {
    setNote(txId, noteText.trim());
    setIsEditingNote(false);
    refresh();
  };

  const handleCancelNote = () => {
    setIsEditingNote(false);
    setNoteText("");
  };

  const handleAddTag = () => {
    const tag = newTag.trim().toLowerCase();
    if (!tag) return;
    addTag(txId, tag);
    setNewTag("");
    refresh();
  };

  const handleRemoveTag = (tag: string) => {
    removeTag(txId, tag);
    refresh();
  };

  const isBookmarked = annotation?.bookmarked ?? false;
  const hasNote = (annotation?.note?.length ?? 0) > 0;
  const tags = annotation?.tags ?? [];
  const hasAnyAnnotation = isBookmarked || hasNote || tags.length > 0;

  // ─── Compact row mode ────────────────────────────────────────────────────────
  if (compact) {
    return (
      <div
        ref={editorRef}
        className="relative flex items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
        role="group"
        aria-label="Transaction annotations"
      >
        {/* Bookmark star (always visible when set, hover-visible otherwise) */}
        <button
          onClick={handleToggleBookmark}
          className={clsx(
            "transition-colors p-0.5",
            isBookmarked
              ? "text-amber-400 hover:text-amber-300"
              : "text-slate-400 hover:text-slate-300 opacity-0 group-hover:opacity-100"
          )}
          aria-label={isBookmarked ? "Remove bookmark" : "Bookmark transaction"}
          title={isBookmarked ? "Bookmarked" : "Bookmark"}
        >
          <StarIcon className={clsx("w-3.5 h-3.5", isBookmarked && "fill-current")} />
        </button>

        {/* Note indicator */}
        {hasNote && (
          <span
            className="text-stellar-500 dark:text-stellar-400"
            title={annotation?.note}
            aria-label="Has note"
          >
            <PencilIcon className="w-3 h-3" />
          </span>
        )}

        {/* Tag chips */}
        {tags.length > 0 && (
          <div className="flex items-center gap-0.5 max-w-24 overflow-hidden">
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-stellar-500/10 text-stellar-600 dark:text-stellar-400 truncate max-w-16"
                title={tag}
              >
                {tag}
              </span>
            ))}
            {tags.length > 2 && (
              <span className="text-[10px] text-slate-500">+{tags.length - 2}</span>
            )}
          </div>
        )}

        {/* Edit annotation (expand) */}
        <button
          onClick={() => setEditorOpen((prev) => !prev)}
          className="text-slate-400 hover:text-stellar-500 dark:hover:text-stellar-300 transition-colors p-0.5 opacity-0 group-hover:opacity-100"
          aria-label="Edit note and tags"
          title="Edit note and tags"
        >
          <PencilIcon className="w-3 h-3" />
        </button>

        {/* Expanded inline editor */}
        {editorOpen && (
          <div className="absolute z-30 mt-6 left-0 right-0">
            <div className="card p-3 space-y-2 bg-white dark:bg-cosmos-900 shadow-xl border border-slate-200 dark:border-slate-700">
              {/* Note */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Note
                </label>
                {isEditingNote ? (
                  <div className="space-y-1.5">
                    <textarea
                      ref={noteInputRef}
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-stellar-500"
                      rows={2}
                      placeholder="Add a private note..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSaveNote();
                        if (e.key === "Escape") handleCancelNote();
                      }}
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={handleSaveNote}
                        className="btn-primary text-[10px] py-1 px-2"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelNote}
                        className="btn-secondary text-[10px] py-1 px-2"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={handleStartNote}
                    className="cursor-pointer rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:border-stellar-400 hover:text-stellar-500 transition-colors"
                  >
                    {hasNote ? annotation!.note : "Add a note"}
                  </div>
                )}
              </div>

              {/* Tags */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Tags
                </label>
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-stellar-500/10 px-2 py-0.5 text-[10px] font-medium text-stellar-600 dark:text-stellar-400"
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:text-red-500 transition-colors"
                        aria-label={`Remove tag "${tag}"`}
                      >
                        <XIcon className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                  {showTagInput ? (
                    <input
                      ref={tagInputRef}
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddTag();
                        }
                        if (e.key === "Escape") setShowTagInput(false);
                      }}
                      onBlur={handleAddTag}
                      className="w-24 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-stellar-500"
                      placeholder="tag..."
                      aria-label="Add tag"
                    />
                  ) : (
                    <button
                      onClick={() => setShowTagInput(true)}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 dark:border-slate-600 px-2 py-0.5 text-[10px] text-slate-500 hover:border-stellar-400 hover:text-stellar-500 transition-colors"
                    >
                      <XIcon className="w-2.5 h-2.5 rotate-45" />
                      Tag
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Full mode (detail pages) ───────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Bookmark */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleToggleBookmark}
          className={clsx(
            "flex items-center gap-1.5 text-sm transition-colors",
            isBookmarked
              ? "text-amber-400 hover:text-amber-300"
              : "text-slate-500 hover:text-slate-400"
          )}
        >
          <StarIcon className={clsx("w-4 h-4", isBookmarked && "fill-current")} />
          <span>{isBookmarked ? "Bookmarked" : "Add bookmark"}</span>
        </button>
      </div>

      {/* Note */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Note
        </label>
        {isEditingNote ? (
          <div className="space-y-2">
            <textarea
              ref={noteInputRef}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-stellar-500"
              rows={3}
              placeholder="Add a private note..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSaveNote();
                if (e.key === "Escape") handleCancelNote();
              }}
            />
            <div className="flex gap-2">
              <button onClick={handleSaveNote} className="btn-primary text-xs py-1.5 px-3">
                Save
              </button>
              <button onClick={handleCancelNote} className="btn-secondary text-xs py-1.5 px-3">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={handleStartNote}
            className="cursor-pointer rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-500 dark:text-slate-400 hover:border-stellar-400 hover:text-stellar-500 transition-colors"
          >
            {hasNote ? annotation!.note : "Click to add a note"}
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Tags
        </label>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-stellar-500/10 px-2.5 py-0.5 text-xs font-medium text-stellar-600 dark:text-stellar-400"
            >
              {tag}
              <button
                onClick={() => handleRemoveTag(tag)}
                className="hover:text-red-500 transition-colors"
                aria-label={`Remove tag "${tag}"`}
              >
                <XIcon className="w-3 h-3" />
              </button>
            </span>
          ))}
          {showTagInput ? (
            <input
              ref={tagInputRef}
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
                if (e.key === "Escape") setShowTagInput(false);
              }}
              onBlur={handleAddTag}
              className="w-24 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-stellar-500"
              placeholder="tag..."
              aria-label="Add tag"
            />
          ) : (
            <button
              onClick={() => setShowTagInput(true)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 dark:border-slate-600 px-2.5 py-0.5 text-xs text-slate-500 hover:border-stellar-400 hover:text-stellar-500 transition-colors"
            >
              <XIcon className="w-3 h-3 rotate-45" />
              Add tag
            </button>
          )}
        </div>
      </div>
    </div>
  );
}