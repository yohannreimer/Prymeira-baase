export type ProcessVersion = {
  version: number;
  title: string;
  body: string;
  changeNote: string;
  editorId: string;
  createdAt: string;
  previous?: ProcessVersion;
};

type NextProcessVersionInput = {
  body: string;
  changeNote: string;
  editorId: string;
  createdAt: string;
};

export function createNextProcessVersion(
  current: ProcessVersion,
  input: NextProcessVersionInput
): ProcessVersion {
  return {
    version: current.version + 1,
    title: current.title,
    body: input.body,
    changeNote: input.changeNote,
    editorId: input.editorId,
    createdAt: input.createdAt,
    previous: current
  };
}
