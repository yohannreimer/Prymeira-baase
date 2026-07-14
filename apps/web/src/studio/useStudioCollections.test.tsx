import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StudioCollection } from "./studio.types";
import { useStudioCollections } from "./useStudioCollections";

const strategy = collection("collection_1", "Estratégia");
const council = collection("collection_2", "Conselho");

describe("useStudioCollections", () => {
  it("keeps an optimistic create when an older list response arrives late", async () => {
    const list = deferred<StudioCollection[]>();
    const create = deferred<StudioCollection>();
    const { result } = renderHook(() => useStudioCollections({
      listCollections: () => list.promise,
      createCollection: () => create.promise,
      renameCollection: vi.fn(),
      deleteCollection: vi.fn()
    }));

    let creation!: Promise<StudioCollection | null>;
    act(() => { creation = result.current.create("Direção"); });
    expect(result.current.collections.map((item) => item.name)).toEqual(["Direção"]);

    await act(async () => list.resolve([strategy]));
    expect(result.current.collections.map((item) => item.name)).toEqual(["Direção"]);
    await act(async () => create.resolve(collection("collection_3", "Direção")));
    await expect(creation).resolves.toMatchObject({ id: "collection_3" });
    expect(result.current.collections.map((item) => item.name)).toEqual(["Direção"]);
  });

  it("updates rename/delete optimistically and restores exact state after errors", async () => {
    const rename = deferred<StudioCollection>();
    const remove = deferred<StudioCollection>();
    const { result } = renderHook(() => useStudioCollections({
      listCollections: async () => [strategy, council],
      createCollection: vi.fn(),
      renameCollection: () => rename.promise,
      deleteCollection: () => remove.promise
    }));
    await act(async () => undefined);

    let renaming!: Promise<StudioCollection | null>;
    act(() => { renaming = result.current.rename(strategy, "Horizonte"); });
    expect(result.current.collections.map((item) => item.name)).toEqual(["Horizonte", "Conselho"]);
    await act(async () => rename.reject(new Error("offline")));
    await expect(renaming).resolves.toBeNull();
    expect(result.current.collections).toEqual([strategy, council]);

    let deleting!: Promise<boolean>;
    act(() => { deleting = result.current.remove(strategy); });
    expect(result.current.collections).toEqual([council]);
    await act(async () => remove.reject(new Error("offline")));
    await expect(deleting).resolves.toBe(false);
    expect(result.current.collections).toEqual([strategy, council]);
  });
});

function collection(id: string, name: string): StudioCollection {
  return { id, name, workspaceId: "workspace_a", ownerProfileId: "owner_a", createdAt: "2026-07-12", updatedAt: "2026-07-12" };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
