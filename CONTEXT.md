# Stavebak

Stavebak is a desktop GUI client for Claude Code (`claude` CLI). This glossary documents domain concepts specific to this project, unifying terminology to avoid ambiguity. All skills should read this before starting work.

## Language

### Sessions and Groups

**Session**:
A single continuous conversation between the user and Claude, stored as a `.jsonl` file by Claude Code.
_Avoid_: chat log, conversation record (use "session" consistently)

**Group**:
A user-created logical grouping for organizing sessions. It is a tag applied to sessions and **does not correspond to any real directory on disk**. Hierarchy: **Project (tier 1, real cwd directory) > Group (tier 2, tag) > Session**. A group belongs to a specific project and only contains sessions from that project. **A session belongs to at most one group** (single membership); moving to a new group removes it from the old one, with no copy left behind. Groups do not change a session's cwd, so sessions in a group still inherit the parent project's `CLAUDE.md` and other context. Users can freely create, name, and drag sessions between groups.
_Avoid_: folder, collection, task folder — never use these terms, as they conflict with the "project" concept

**Project (Workspace)**:
The automatic first-level grouping that Claude Code creates based on a session's working directory (cwd), corresponding to real directories under `~/.claude/projects/`. This is an engine-level concept, not user-maintained. Users may colloquially call it "root directory" or "workspace".
_Avoid_: using "workspace folder" to refer to a user's "group"

**Export**:
Copying sessions from a group into a real Finder folder as a backup. Original session files remain untouched.
_Avoid_: sync, mirror (refers to a rejected real-time approach, do not conflate)

## Example dialogue

> **Dev**: The user says "put this session into the Expenses group" — is "group" the same as a project?
> **Domain**: No. A project is automatically created by the engine based on the working directory and has a real directory on disk. A "group" is a user-created tag applied to sessions — there is no corresponding folder on disk.
> **Dev**: Will "export the Expenses group" affect the original session files?
> **Domain**: No. Export copies them to Finder. The originals stay in the engine's directory structure — moving them would break session resumption.
