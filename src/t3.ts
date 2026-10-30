// The t3-code-integration catalog item: routes the flows through the T3 Code MCP server when a
// session runs inside T3 Code, and changes nothing anywhere else.

/** The catalog item's ID. */
export const T3_ITEM = "t3-code-integration";

/** The MCP server T3 Code adds to every session it starts. */
export const T3_SERVER = "t3-code";

/**
 * T3 Code tools that start work in a child agent, another thread, a worktree or a scheduled run.
 * The planning guard denies them; keep in step with T3_LAUNCH_TOOLS in assets/planning-guard.mjs.
 */
export const T3_LAUNCH_TOOLS = [
  "delegate_task",
  "t3_thread_launch",
  "create_threads",
  "t3_thread_send",
  "t3_worktree_handoff",
  "schedule_task",
  "run_scheduled_task_now",
] as const;

/** T3 Code's child-agent tool, whose handoffs the brief guard checks. */
export const T3_DELEGATE_TOOL = "delegate_task";

/** Claude's name for a T3 Code tool, as a hook matcher sees it. */
export const claudeT3Tool = (tool: string): string => `mcp__${T3_SERVER}__${tool}`;
