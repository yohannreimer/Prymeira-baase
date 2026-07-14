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

type CollectionMutation = {
  token: number;
  status: "pending" | "successful";
} & ({
  type: "create";
  collection?: StudioCollection;
} | {
  type: "rename";
  collectionId: string;
  original: StudioCollection;
  name: string;
  collection?: StudioCollection;
} | {
  type: "delete";
  collectionId: string;
  original: StudioCollection;
});

type CollectionMutationInput =
  | { type: "create" }
  | { type: "rename"; collectionId: string; original: StudioCollection; name: string }
  | { type: "delete"; collectionId: string; original: StudioCollection };

const defaultDependencies: StudioCollectionsDependencies = {
  listCollections: (signal) => listStudioCollections(fetch, signal),
  createCollection: (name, signal) => createStudioCollection(name, signal),
  renameCollection: (collectionId, name, signal) => renameStudioCollection(collectionId, name, signal),
  deleteCollection: (collectionId, signal) => deleteStudioCollection(collectionId, signal)
};

export function useStudioCollections(
  dependencies: StudioCollectionsDependencies = defaultDependencies
): StudioCollectionsStore {
  const [collections, setCollections] = useState<StudioCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const snapshot = useRef<StudioCollection[] | null>(null);
  const preloadBaseline = useRef<StudioCollection[]>([]);
  const mutations = useRef<CollectionMutation[]>([]);
  const mutationSequence = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const dependenciesRef = useRef(dependencies);

  function publish() {
    setCollections(applyCollectionMutations(snapshot.current ?? preloadBaseline.current, mutations.current));
  }

  function rememberBeforeLoad(collection: StudioCollection) {
    if (snapshot.current || preloadBaseline.current.some((item) => item.id === collection.id)) return;
    preloadBaseline.current = [...preloadBaseline.current, collection];
  }

  function begin(mutation: CollectionMutationInput) {
    const token = ++mutationSequence.current;
    mutations.current = [...mutations.current, { ...mutation, token, status: "pending" } as CollectionMutation];
    publish();
    return token;
  }

  function succeed(token: number, collection?: StudioCollection) {
    mutations.current = mutations.current.map((mutation) => mutation.token === token
      ? { ...mutation, status: "successful", ...(collection ? { collection } : {}) } as CollectionMutation
      : mutation);
    if (snapshot.current) {
      const completed = mutations.current.find((mutation) => mutation.token === token);
      if (completed) snapshot.current = applyCollectionMutation(snapshot.current, completed);
      mutations.current = mutations.current.filter((mutation) => mutation.token !== token);
    }
    publish();
  }

  function fail(token: number) {
    mutations.current = mutations.current.filter((mutation) => mutation.token !== token);
    publish();
  }

  useEffect(() => {
    const controller = trackController(controllers.current);
    setLoading(true);
    setLoadError(false);
    void dependenciesRef.current.listCollections(controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      const completed = mutations.current.filter((mutation) => mutation.status === "successful");
      snapshot.current = applyCollectionMutations(items, completed);
      mutations.current = mutations.current.filter((mutation) => mutation.status === "pending");
      publish();
      setLoading(false);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setLoadError(true);
      setLoading(false);
    }).finally(() => controllers.current.delete(controller));
    return () => controller.abort();
  }, []);

  useEffect(() => () => {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
  }, []);

  async function create(name: string) {
    const token = begin({ type: "create" });
    const controller = trackController(controllers.current);
    try {
      const created = await dependenciesRef.current.createCollection(name, controller.signal);
      if (controller.signal.aborted) return null;
      succeed(token, created);
      return created;
    } catch {
      if (!controller.signal.aborted) fail(token);
      return null;
    } finally {
      controllers.current.delete(controller);
    }
  }

  async function rename(collection: StudioCollection, name: string) {
    rememberBeforeLoad(collection);
    const token = begin({ type: "rename", collectionId: collection.id, original: collection, name });
    const controller = trackController(controllers.current);
    try {
      const updated = await dependenciesRef.current.renameCollection(collection.id, name, controller.signal);
      if (controller.signal.aborted) return null;
      succeed(token, updated);
      return updated;
    } catch {
      if (!controller.signal.aborted) fail(token);
      return null;
    } finally {
      controllers.current.delete(controller);
    }
  }

  async function remove(collection: StudioCollection) {
    rememberBeforeLoad(collection);
    const token = begin({ type: "delete", collectionId: collection.id, original: collection });
    const controller = trackController(controllers.current);
    try {
      await dependenciesRef.current.deleteCollection(collection.id, controller.signal);
      if (controller.signal.aborted) return false;
      succeed(token);
      return true;
    } catch {
      if (!controller.signal.aborted) fail(token);
      return false;
    } finally {
      controllers.current.delete(controller);
    }
  }

  return { collections, loading, loadError, create, rename, remove };
}

function applyCollectionMutations(base: StudioCollection[], mutations: CollectionMutation[]) {
  return mutations.reduce(applyCollectionMutation, base);
}

function applyCollectionMutation(collections: StudioCollection[], mutation: CollectionMutation) {
  if (mutation.type === "create") {
    if (mutation.status !== "successful" || !mutation.collection) return collections;
    return replaceOrAppend(collections, mutation.collection);
  }
  if (mutation.type === "delete") {
    return collections.filter((item) => item.id !== mutation.collectionId);
  }

  const updated = mutation.status === "successful" && mutation.collection
    ? mutation.collection
    : { ...mutation.original, name: mutation.name, updatedAt: new Date().toISOString() };
  return replaceOrAppend(collections, updated);
}

function replaceOrAppend(collections: StudioCollection[], collection: StudioCollection) {
  return collections.some((item) => item.id === collection.id)
    ? collections.map((item) => item.id === collection.id ? collection : item)
    : [...collections, collection];
}

function trackController(controllers: Set<AbortController>) {
  const controller = new AbortController();
  controllers.add(controller);
  return controller;
}
