import { useCallback, useEffect, useState } from "react";
import {
  PiArrowUpBold,
  PiArrowDownBold,
  PiArrowsClockwiseBold,
  PiCheckBold,
  PiWarningCircleDuotone,
} from "react-icons/pi";

interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  topics: string[];
  pushed_at: string | null;
}

interface HighlightEntry {
  repoFullName: string;
  blurb: string;
  sortOrder: number;
}

interface RepoPickerProps {
  profileId: string;
  existingHighlights: HighlightEntry[];
  hasGitHubToken: boolean;
}

const MAX_HIGHLIGHTS = 6;
const MAX_BLURB = 500;

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; repos: GitHubRepo[] }
  | { status: "no_token" }
  | { status: "auth_error" }
  | { status: "error"; message: string };

export default function RepoPicker({
  existingHighlights,
  hasGitHubToken,
}: RepoPickerProps) {
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [selected, setSelected] = useState<HighlightEntry[]>(existingHighlights);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const fetchRepos = useCallback(async () => {
    if (!hasGitHubToken) {
      setFetchState({ status: "no_token" });
      return;
    }
    setFetchState({ status: "loading" });
    try {
      const res = await fetch("/api/portfolio/repos");
      if (res.status === 401) {
        setFetchState({ status: "auth_error" });
        return;
      }
      const data = (await res.json()) as {
        error?: string;
        repos?: GitHubRepo[];
      };
      if (data.error === "no_token") {
        setFetchState({ status: "no_token" });
        return;
      }
      if (data.error === "auth_error") {
        setFetchState({ status: "auth_error" });
        return;
      }
      if (!res.ok) {
        setFetchState({
          status: "error",
          message: data.error ?? "Failed to fetch repositories",
        });
        return;
      }
      setFetchState({ status: "loaded", repos: data.repos ?? [] });
    } catch {
      setFetchState({ status: "error", message: "Network error" });
    }
  }, [hasGitHubToken]);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  function isSelected(fullName: string) {
    return selected.some((s) => s.repoFullName === fullName);
  }

  function toggleRepo(fullName: string) {
    if (isSelected(fullName)) {
      setSelected(selected.filter((s) => s.repoFullName !== fullName));
    } else if (selected.length < MAX_HIGHLIGHTS) {
      setSelected([
        ...selected,
        {
          repoFullName: fullName,
          blurb: "",
          sortOrder: selected.length,
        },
      ]);
    }
  }

  function updateBlurb(fullName: string, blurb: string) {
    setSelected(
      selected.map((s) =>
        s.repoFullName === fullName ? { ...s, blurb } : s,
      ),
    );
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...selected];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setSelected(next.map((s, i) => ({ ...s, sortOrder: i })));
  }

  function moveDown(index: number) {
    if (index >= selected.length - 1) return;
    const next = [...selected];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setSelected(next.map((s, i) => ({ ...s, sortOrder: i })));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const body = selected.map((s, i) => ({
        repoFullName: s.repoFullName,
        blurb: s.blurb,
        sortOrder: i,
      }));
      const res = await fetch("/api/portfolio/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSaveMessage({
          type: "error",
          text: data.error ?? "Failed to save highlights",
        });
      } else {
        setSaveMessage({ type: "success", text: "Highlights saved" });
      }
    } catch {
      setSaveMessage({ type: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/portfolio/highlights", {
        method: "PUT",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSaveMessage({
          type: "error",
          text: data.error ?? "Failed to refresh",
        });
      } else {
        setSaveMessage({ type: "success", text: "Snapshots refreshed from GitHub" });
      }
    } catch {
      setSaveMessage({ type: "error", text: "Network error" });
    } finally {
      setRefreshing(false);
    }
  }

  if (fetchState.status === "idle" || fetchState.status === "loading") {
    return (
      <p className="text-ink-secondary">Fetching your repositories…</p>
    );
  }

  if (fetchState.status === "no_token") {
    return (
      <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
        <PiWarningCircleDuotone className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" />
        <p className="text-amber-300">
          We couldn't reach your GitHub account. Your highlights will appear
          here once your GitHub connection is available.
        </p>
      </div>
    );
  }

  if (fetchState.status === "auth_error") {
    return (
      <div className="flex items-start gap-3 rounded-md border border-red-500/30 bg-red-500/10 p-4">
        <PiWarningCircleDuotone className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-400" />
        <p className="text-red-300">
          Sign out and back in to reconnect GitHub.
        </p>
      </div>
    );
  }

  if (fetchState.status === "error") {
    return (
      <div className="flex items-start gap-3 rounded-md border border-red-500/30 bg-red-500/10 p-4">
        <PiWarningCircleDuotone className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-400" />
        <p className="text-red-300">{fetchState.message}</p>
      </div>
    );
  }

  const repos = fetchState.repos;

  return (
    <div className="space-y-6">
      {/* Selected repos panel */}
      {selected.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-white/90">
            Selected ({selected.length}/{MAX_HIGHLIGHTS})
          </h4>
          {selected.map((entry, index) => {
            const repo = repos.find(
              (r) => r.full_name === entry.repoFullName,
            );
            return (
              <div
                key={entry.repoFullName}
                className="rounded-md border border-primary/30 bg-primary/5 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">
                    {entry.repoFullName}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveUp(index)}
                      disabled={index === 0}
                      className="rounded p-1 text-ink-secondary hover:bg-white/10 disabled:opacity-30"
                      aria-label={`Move ${entry.repoFullName} up`}
                    >
                      <PiArrowUpBold className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDown(index)}
                      disabled={index === selected.length - 1}
                      className="rounded p-1 text-ink-secondary hover:bg-white/10 disabled:opacity-30"
                      aria-label={`Move ${entry.repoFullName} down`}
                    >
                      <PiArrowDownBold className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleRepo(entry.repoFullName)}
                      className="rounded p-1 text-red-400 hover:bg-red-500/10"
                      aria-label={`Remove ${entry.repoFullName}`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {repo?.description && (
                  <p className="mt-1 text-xs text-ink-muted">
                    {repo.description}
                  </p>
                )}
                <textarea
                  value={entry.blurb}
                  onChange={(e) =>
                    updateBlurb(entry.repoFullName, e.target.value)
                  }
                  maxLength={MAX_BLURB}
                  rows={2}
                  placeholder="What you built, your role, the stack"
                  className="mt-2 w-full rounded-md border border-teal bg-dark/50 px-3 py-2 text-sm text-white placeholder:text-ink-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  aria-label={`Blurb for ${entry.repoFullName}`}
                />
                <p className="mt-1 text-right text-xs text-ink-muted">
                  {entry.blurb.length}/{MAX_BLURB}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Repo list */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-white/90">
          Your Repositories
        </h4>
        {repos.length === 0 && (
          <p className="text-sm text-ink-secondary">
            No public repositories found.
          </p>
        )}
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {repos.map((repo) => {
            const checked = isSelected(repo.full_name);
            const disabled = !checked && selected.length >= MAX_HIGHLIGHTS;
            return (
              <button
                key={repo.full_name}
                type="button"
                onClick={() => toggleRepo(repo.full_name)}
                disabled={disabled}
                className={`flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                  checked
                    ? "border-primary/40 bg-primary/10"
                    : disabled
                      ? "cursor-not-allowed border-teal/10 opacity-50"
                      : "border-teal/20 hover:border-teal/40 hover:bg-dark/50"
                }`}
                aria-label={`${checked ? "Deselect" : "Select"} ${repo.full_name}`}
              >
                <div
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                    checked
                      ? "border-primary bg-primary text-dark"
                      : "border-teal/40"
                  }`}
                >
                  {checked && <PiCheckBold className="h-3 w-3" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-white">
                      {repo.full_name}
                    </span>
                    {repo.language && (
                      <span className="rounded bg-teal/20 px-1.5 py-0.5 text-xs text-ink-secondary">
                        {repo.language}
                      </span>
                    )}
                    {repo.stargazers_count > 0 && (
                      <span className="text-xs text-ink-muted">
                        ★ {repo.stargazers_count}
                      </span>
                    )}
                  </div>
                  {repo.description && (
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {repo.description}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Save message */}
      {saveMessage && (
        <div
          className={`rounded-md border p-3 text-sm ${
            saveMessage.type === "success"
              ? "border-green-500/30 bg-green-500/10 text-green-300"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {saveMessage.text}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-dark transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Highlights"}
        </button>
        {existingHighlights.length > 0 && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-md border border-teal/40 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal/20 disabled:opacity-50"
          >
            <PiArrowsClockwiseBold className="h-4 w-4" />
            {refreshing ? "Refreshing…" : "Refresh from GitHub"}
          </button>
        )}
      </div>
    </div>
  );
}
