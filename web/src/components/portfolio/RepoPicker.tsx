import { useCallback, useEffect, useState } from "react";
import { PiArrowDownBold, PiArrowUpBold, PiArrowsClockwiseBold, PiXBold } from "react-icons/pi";
import { Button, Chip, ChoiceCard, HINT, IconButton, Notice, TextAreaField } from "@/components/platform/ui";

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
  const [selected, setSelected] =
    useState<HighlightEntry[]>(existingHighlights);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
    details?: string[];
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
      setFetchState({ status: "error", message: "That didn't reach GitHub. Check your connection and reload the page." });
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
      selected.map((s) => (s.repoFullName === fullName ? { ...s, blurb } : s)),
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
      const data = (await res.json()) as {
        error?: string;
        moderationMessages?: string[];
      };
      if (!res.ok) {
        setSaveMessage({
          type: "error",
          text: data.error ?? "Your highlights weren't saved",
          details: data.moderationMessages,
        });
      } else {
        setSaveMessage({ type: "success", text: "Highlights saved" });
      }
    } catch {
      setSaveMessage({ type: "error", text: "That didn't reach us. Check your connection and try again." });
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
      const data = (await res.json()) as {
        error?: string;
        moderationMessages?: string[];
      };
      if (!res.ok) {
        setSaveMessage({
          type: "error",
          text: data.error ?? "Your highlights weren't refreshed",
          details: data.moderationMessages,
        });
      } else {
        setSaveMessage({
          type: "success",
          text: "Highlights refreshed from GitHub",
        });
      }
    } catch {
      setSaveMessage({ type: "error", text: "That didn't reach us. Check your connection and try again." });
    } finally {
      setRefreshing(false);
    }
  }

  if (fetchState.status === "idle" || fetchState.status === "loading") {
    return <p className="m-0 text-ink-secondary">Fetching your repositories…</p>;
  }

  if (fetchState.status === "no_token") {
    return (
      <Notice tone="warning" title="GitHub isn't connected">
        We couldn't reach your GitHub account. Your repositories appear here once the connection works.
      </Notice>
    );
  }

  if (fetchState.status === "auth_error") {
    return (
      <Notice tone="danger" title="GitHub needs you to sign in again">
        Sign out and back in to reconnect GitHub.
      </Notice>
    );
  }

  if (fetchState.status === "error") {
    return (
      <Notice tone="danger" title="Your repositories didn't load">
        {fetchState.message}
      </Notice>
    );
  }

  const repos = fetchState.repos;

  return (
    <div className="flex flex-col gap-6">
      {selected.length > 0 && (
        <section aria-labelledby="highlights-chosen" className="flex flex-col gap-3">
          <h3 id="highlights-chosen" className="m-0 text-base leading-snug text-ink-primary">
            Chosen ({selected.length} of {MAX_HIGHLIGHTS})
          </h3>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {selected.map((entry, index) => {
              const repo = repos.find((r) => r.full_name === entry.repoFullName);
              return (
                <li key={entry.repoFullName} data-highlight={entry.repoFullName} className="flex flex-col gap-3 rounded-[1.125rem] border border-hairline bg-ink-primary/4 p-4">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold break-all text-ink-primary">{entry.repoFullName}</p>
                      {repo?.description && <p className={`m-0 mt-1 ${HINT}`}>{repo.description}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton size="sm" label={`Move ${entry.repoFullName} up`} icon={<PiArrowUpBold aria-hidden />} onClick={() => moveUp(index)} disabled={index === 0} />
                      <IconButton size="sm" label={`Move ${entry.repoFullName} down`} icon={<PiArrowDownBold aria-hidden />} onClick={() => moveDown(index)} disabled={index === selected.length - 1} />
                      <IconButton size="sm" label={`Remove ${entry.repoFullName}`} icon={<PiXBold aria-hidden />} onClick={() => toggleRepo(entry.repoFullName)} />
                    </div>
                  </div>
                  <TextAreaField
                    label={`About ${entry.repoFullName}`}
                    hint={`What you built, your part in it, the stack. ${entry.blurb.length} of ${MAX_BLURB} characters.`}
                    name={`blurb-${index}`}
                    value={entry.blurb}
                    onChange={(e) => updateBlurb(entry.repoFullName, e.target.value)}
                    maxLength={MAX_BLURB}
                    rows={2}
                  />
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section aria-labelledby="highlights-repos" className="flex flex-col gap-3">
        <h3 id="highlights-repos" className="m-0 text-base leading-snug text-ink-primary">Your repositories</h3>
        {repos.length === 0 ? (
          <p className="m-0 text-sm text-ink-secondary">No public repositories found.</p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
            {repos.map((repo) => {
              const checked = isSelected(repo.full_name);
              return (
                <ChoiceCard
                  key={repo.full_name}
                  type="checkbox"
                  name="highlight"
                  value={repo.full_name}
                  label={repo.full_name}
                  hint={repo.description ?? undefined}
                  detail={repo.language || repo.stargazers_count > 0 ? (
                    <>
                      {repo.language && <Chip>{repo.language}</Chip>}
                      {repo.stargazers_count > 0 && <span className={HINT}>{repo.stargazers_count} {repo.stargazers_count === 1 ? "star" : "stars"}</span>}
                    </>
                  ) : undefined}
                  checked={checked}
                  disabled={!checked && selected.length >= MAX_HIGHLIGHTS}
                  onChange={() => toggleRepo(repo.full_name)}
                />
              );
            })}
          </div>
        )}
      </section>

      {saveMessage && (
        <Notice tone={saveMessage.type === "success" ? "success" : "danger"} title={saveMessage.text}>
          {saveMessage.details && saveMessage.details.length > 0 && (
            <ul className="m-0 list-disc space-y-1 pl-5">
              {saveMessage.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} loading={saving}>
          {saving ? "Saving…" : "Save highlights"}
        </Button>
        {existingHighlights.length > 0 && (
          <Button variant="ghost" onClick={handleRefresh} loading={refreshing} icon={<PiArrowsClockwiseBold aria-hidden />}>
            {refreshing ? "Refreshing…" : "Refresh from GitHub"}
          </Button>
        )}
      </div>
    </div>
  );
}
