export type ProjectOperationTask = "library" | "load" | "save" | "transfer";

export type ProjectOperationState =
  | { status: "idle" }
  | { status: "loading"; task: "library" | "load"; projectId?: string }
  | { status: "saving"; projectId: string }
  | { status: "transferring"; projectId: string }
  | {
      status: "error";
      task: ProjectOperationTask;
      projectId?: string;
      message: string;
    };

export type ProjectOperationAction =
  | { type: "start"; operation: Exclude<ProjectOperationState, { status: "idle" | "error" }> }
  | { type: "finish" }
  | {
      type: "fail";
      task: ProjectOperationTask;
      projectId?: string;
      message: string;
    };

export function projectOperationReducer(
  _state: ProjectOperationState,
  action: ProjectOperationAction,
): ProjectOperationState {
  if (action.type === "start") return action.operation;
  if (action.type === "finish") return { status: "idle" };
  return {
    status: "error",
    task: action.task,
    projectId: action.projectId,
    message: action.message,
  };
}

export const idleProjectOperation: ProjectOperationState = { status: "idle" };
