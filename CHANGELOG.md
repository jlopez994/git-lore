# Changelog

## 0.10.2

- Contributors: suggested merges. The view tells you how many likely duplicates there are, and the lightbulb in its
  title lists them: same name, same user in the email (GitHub `noreply` addresses included), a login that matches
  someone's email, or a similar name such as "Iker M" and "Iker Martínez". Tick the ones to merge and they are applied
  together, with one Undo. The doubtful ones (similar names) start unticked.
- Contributors chart: right-click a bubble or a row to merge that person into someone else.
- Commit graph: checkout, merge, cherry-pick, reset and the other actions show that they are working: a bar runs along
  the toolbar, the refresh icon spins and the status bar says what is going on, until the graph has reloaded.
- Commit graph: clicking the highlight button several times in a row no longer makes it flash back to the previous
  state before settling.
- Contributors: merge notices name the emails too, so two people with the same name can be told apart.
- Contributors chart, Visual File History and commit graph: right-clicking no longer offers Cut, Copy and Paste where
  there is nothing to cut or paste. The graph's filter box and a commit's message keep them.

## 0.10.1

- Contributors: a merge button appears when you hover a person, so `Merge Into…` no longer needs a right-click. On
  identities with the same name as another, that button merges them in one click.
- Contributors: with several repositories open, the repository button in the view's title picks which one to show,
  and the view stays on it (shown as pinned) until you choose `Follow the active editor` again. The choice is
  remembered per workspace. Without an editor from a repository, the view now shows the one selected in Source
  Control instead of the first one.

## 0.10.0

- Contributors: merge identities that belong to the same person. Right-click a person and choose `Merge Into…`, or
  use the merge button that appears next to identities with the same name and a different email. The view and the
  chart count them as one. Merges live in a private mailmap per repository, outside the repository, and
  `Edit Merged Identities` opens it to undo or adjust them. The repository's `.mailmap` still applies.
- Commit graph: when the repository changes (a commit, a checkout, a fetch), only the rows that changed are redrawn.
  The rest stay put, without flashing, and the scroll, the focused row and the open commit are kept.

## 0.9.1

- Fix: with several repositories open, the Contributors chart no longer opens the first one without asking. Like the
  commit graph, it uses the repository of the active editor and, without one, asks which repository to show.

## 0.9.0

- Contributors chart: a Contributors button in the status bar, next to Graph, opens it for the active repository.
- Contributors chart: with many authors the bubbles get more room. The chart grows taller with the number of
  people, the cloud follows the shape of the panel instead of stopping at three times as wide as tall, and in wide
  panels it sits beside the table and stays in view while you scroll the list.

## 0.8.1

- Commit graph: dimming the commits outside the history of your HEAD is now off by default and remembered, with the
  new setting `gitLore.graph.highlightCurrentBranch`. The target button in the toolbar still toggles it, and changes
  the setting.
- Commit graph: the target button, when on, looks like VS Code's own toggles (the ones in the search box) instead of
  a gray square.

## 0.8.0

- Contributors chart: the chart icon in the Contributors view (or `Show Contributors Chart`) opens a bubble per
  person, sized by their commits to the current branch, and a table with everyone's commits, share and lines added
  and deleted. Hover a bubble or a row for the details; it updates when you switch branch or commit.
- Visual File History: red and cyan swap places, so neighboring rows are easier to tell apart in light themes too.

## 0.7.0

- Contributors view in the Source Control panel: everyone who committed to the current branch, by number of commits
  (one person per email, even with several names). Expand someone to see their commits and click one for its files.
  The same commit menu as File History: copy the SHA, open it on the remote.
- Visual File History: the SHA in the tooltip no longer has extra background on its left, and counts of one say
  "1 commit" and "1 author".
- Commit graph: commit details open instantly the second time (they are kept while the graph is open), without the
  expand animation, and the loading placeholder only shows if loading takes a moment.
- Commit graph: easier to find where you are among many branches. Commits that are not in the history of your HEAD
  are dimmed (toggle it with the target button in the toolbar), and when your commit scrolls out of view a "↑ main"
  / "↓ main" button takes you back to it, loading more commits if needed.
- Fix: on tall screens the rows of the commit graph no longer pop in all at once halfway down while it draws.

- The commit graph redraws by itself when any branch, remote branch, tag or stash moves: VS Code's background
  auto-fetch (`git.autofetch`), a fetch or push from the terminal, or branches, tags and stashes made outside it.
  Before, it only noticed changes to the current branch and to uncommitted files.
- Fix: hovering a row no longer clips the ring of the current branch badge or the node of the leftmost lane.

## 0.6.0

- Step through a file's revisions from the editor title: ← opens the diff of the previous commit to the file, → the
  next one, and from the newest commit → goes back to the working file. It follows renames.

## 0.5.0

- Visual File History: `Show Visual File History` (editor and tab context menus, Explorer, or the icon in the File
  History view) draws every commit to a file as a dot on a timeline, one row per author, sized by the lines it changed,
  with the added and deleted lines below. Hover a dot for the commit, click it for its diff, or move between commits
  with the arrow keys. Hover an author to highlight their commits.
- Commit graph: livelier colors, with its own vivid palette (a darker one for light themes; high contrast keeps the
  theme's), and branch badges in the color of their lane: local branches filled, remote ones tinted, tags neutral, each
  with an icon.
- Commit graph: more room for the message. The graph takes at most 15% of the panel by default (drag its edge for
  more), and the author, date and SHA columns are narrower.
- Commit graph: stashes show up as rows hanging from the commit they were made on, with a hollow node. Click one for
  its files; right-click to apply, pop or drop it.
- Commit graph: worktrees. Branches checked out in another worktree carry a folder icon (hover it for the path), a
  detached worktree gets its own badge and its commit is always drawn, and right-click opens the worktree in a new
  window. Checkout and delete are hidden for those branches, since git refuses them.

## 0.4.1

- Branch and tag badges show long names in full (up to 24em) and shrink only when the row is crowded; hover one for its
  full name. Their text no longer sits on the bottom border with Windows fonts.
- Hover a commit message to read it in full, with its short SHA, author and date.
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
