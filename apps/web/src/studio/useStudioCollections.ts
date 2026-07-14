import { useEffect, useRef, useState } from "react";
import {
  createStudioCollection,
  deleteStudioCollection,
  listStudioCollections,
  renameStudioCollection
} from "./studio-api";
import type { StudioCollection } from "./studio.types";

export type StudioCollectionsDependencies = {
  listCollections(signal: AbortSignal): Promise<StudioCollection[]>;
  createCollection(name: string, signal: AbortSignal): Promise<StudioCollection>;
  renameCollection(collectionId: string, name: string, signal: AbortSignal): Promise<StudioCollection>;
  deleteCollection(collectionId: string, signal: AbortSignal): Promise<StudioCollection>;
};

export type StudioCollectionsStore = {
  collections: StudioCollection[];
  loading: boolean;
  loadError: boolean;
  create(name: string): Promise<StudioCollection | null>;
  rename(collection: StudioCollection, name: string): Promise<StudioCollection | null>;
  remove(collection: StudioCollection): Promise<boolean>;
};

const defaultDependencies: StudioCollectionsDependencies = {
  listCollections: (signal) => listStudioCollections(fetch, signal),
  createCollection: (name, signal) => createStudioCollection(name, signal),
  renameCollection: (collectionId, name, signal) => renameStudioCollection(collectionId, name, signal),
  deleteCollection: (collectionId, signal) => deleteStudioCollection(collectionId, signal)
};

let optimisticSequence = 0;

export function useStudioCollections(
  dependencies: StudioCollectionsDependencies = defaultDependencies
): StudioCollectionsStore {
  const [collections, setCollections] = useState<StudioCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const collectionsRef = useRef<StudioCollection[]>([]);
  const generation = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const dependenciesRef = useRef(dependencies);

  function replace(next: StudioCollection[]) {
    collectionsRef.current = next;
    setCollections(next);
  }

  useEffect(() => {
    const requestGeneration = ++generation.current;
    const controller = trackController(controllers.current);
    setLoading(true);
    setLoadError(false);
    void dependenciesRef.current.listCollections(controller.signal).then((items) => {
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      replace(items);
      setLoading(false);
    }).catch(() => {
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      setLoadError(true);
      setLoading(false);
    }).finally(() => controllers.current.delete(controller));
    return () => controller.abort();
  }, []);

  useEffect(() => () => {
    generation.current += 1;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
  }, []);

  async function create(name: string) {
    generation.current += 1;
    setLoading(false);
    const now = new Date().toISOString();
    const temporaryId = `optimistic_collection_${++optimisticSequence}`;
    const optimistic: StudioCollection = {
      id: temporaryId,
      workspaceId: "",
      ownerProfileId: "",
      name,
      createdAt: now,
      updatedAt: now
    };
    replace([...collectionsRef.current, optimistic]);
    const controller = trackController(controllers.current);
    try {
      const created = await dependenciesRef.current.createCollection(name, controller.signal);
      if (controller.signal.aborted) return null;
      replace(collectionsRef.current.map((item) => item.id === temporaryId ? created : item));
      return created;
    } catch {
      if (!controller.signal.aborted) replace(collectionsRef.current.filter((item) => item.id !== temporaryId));
      return null;
    } finally {
      controllers.current.delete(controller);
    }
  }

  async function rename(collection: StudioCollection, name: string) {
    generation.current += 1;
    replace(collectionsRef.current.map((item) => item.id === collection.id
      ? { ...item, name, updatedAt: new Date().toISOString() }
      : item));
    const controller = trackController(controllers.current);
    try {
      const updated = await dependenciesRef.current.renameCollection(collection.id, name, controller.signal);
      if (controller.signal.aborted) return null;
      replace(collectionsRef.current.map((item) => item.id === collection.id ? updated : item));
      return updated;
    } catch {
      if (!controller.signal.aborted) {
        replace(collectionsRef.current.map((item) => item.id === collection.id ? collection : item));
      }
      return null;
    } finally {
      controllers.current.delete(controller);
    }
  }

  async function remove(collection: StudioCollection) {
    generation.current += 1;
    const index = collectionsRef.current.findIndex((item) => item.id === collection.id);
    replace(collectionsRef.current.filter((item) => item.id !== collection.id));
    const controller = trackController(controllers.current);
    try {
      await dependenciesRef.current.deleteCollection(collection.id, controller.signal);
      return !controller.signal.aborted;
    } catch {
      if (!controller.signal.aborted && !collectionsRef.current.some((item) => item.id === collection.id)) {
        const restored = [...collectionsRef.current];
        restored.splice(Math.max(0, index), 0, collection);
        replace(restored);
      }
      return false;
    } finally {
      controllers.current.delete(controller);
    }
  }

  return { collections, loading, loadError, create, rename, remove };
}

function trackController(controllers: Set<AbortController>) {
  const controller = new AbortController();
  controllers.add(controller);
  return controller;
}
