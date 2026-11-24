# Changelog

## 0.4.1

- Branch and tag badges show long names in full (up to 24em) and shrink only when the row is crowded; hover one for its
  full name. Their text no longer sits on the bottom border with Windows fonts.
- Clicking a commit no longer nudges its row, so the graph lines stay joined. Rows fade in without moving.

## 0.4.0

- Commit graph: right-click a commit to create a branch or tag on it, check it out, cherry-pick it, revert it or reset
  the current branch to it (soft, mixed or hard). Shift+F10 opens the same menu from the keyboard.
- Commit graph: right-click a branch or tag badge to check it out, merge it into the current branch or delete it.
  Checking out a remote branch creates the local branch that tracks it, or switches to it if it exists.
- Commit graph: right-click a file in the commit details to open its changes, open it at that revision, compare it with
  the working file, open the working file, copy its path or relative path, or restore it to that revision.
- Commit graph: hover the author to see their full name and email.
- Commit graph: a Fetch button in the toolbar fetches from all remotes and redraws the graph.
- Commit graph: narrower lanes, and the graph takes at most a fifth of the panel (wider repos fade out at the edge).
  Drag its edge to resize it, or double-click it to go back to automatic.
- Fix: local branches with a `/` in their name (`feat/x`) were drawn as remote branches.
- Fix: going back to the commit graph after opening a diff keeps the scroll position, filter and open commit instead of
  reloading.
- Fix: the open commit stays open when the graph reloads because the repository changed.
- Fix: scrolling to the bottom of the commit graph always loads the next page, also after a reload, after clearing the
  filter or when coming back to the tab.
- The refresh button spins its icon only, not the whole button.
- Fix: the graph width shrinks again after switching to fewer branches or reloading.

## 0.3.0

- A "Graph" button in the status bar opens the commit graph of the active repository, like Git Graph. Right-click the
  status bar to hide it.
- Smoother loading in the commit graph: placeholder rows shaped like real ones with a single shimmer, a spinning refresh
  button, placeholder rows while the next page loads and a placeholder for the commit details.
- Fix: with reduced motion enabled, the loading placeholders no longer flicker.

## 0.2.0

- Commit graph: click a commit to open its details inside the graph (full message, author, parents and changed files;
  each file opens its diff). Escape or a second click closes it.
- Commit graph: an "Uncommitted changes" row above HEAD while the working tree has changes.
- Commit graph: choose all branches, local branches only or the current branch.
- Commit graph: refs from other tools (stash, notes, `refs/t3/…`) no longer show up.
- Fix: the commit graph filter now hides the rows that don't match.
- Compare References has its own icon in the Source Control title bar.

## 0.1.0

- Current line blame at the end of the line, with a hover: full message, open changes, copy SHA, open on
  GitHub/GitLab/Bitbucket/Azure DevOps and line history.
- File blame: a column with the commit of each block and a heat map from recent (orange) to old (blue).
- File history and line history in the Source Control panel, following renames; click a commit to see its diff.
- Commit graph of all branches, paged as you scroll, with filtering, branch and tag badges and copy SHA.
- Compare two branches, tags or commits, or a ref with the working tree.
