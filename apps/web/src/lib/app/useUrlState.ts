import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

type UrlStatePrimitive = string | number | boolean | null | undefined;
type UrlStateValue = UrlStatePrimitive | UrlStatePrimitive[];
export type UrlStateRecord = Record<string, UrlStateValue>;

function isEmptyUrlStateValue(value: UrlStateValue) {
  if (value == null) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isSameUrlStateValue(left: UrlStateValue, right: UrlStateValue) {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }

  return left === right;
}

function sanitizeUrlState<T extends UrlStateRecord>(
  value: T,
  defaults: T,
): Partial<T> {
  const entries = Object.entries(value).filter(([key, currentValue]) => {
    if (isEmptyUrlStateValue(currentValue)) return false;

    const defaultValue = defaults[key];
    if (
      defaultValue !== undefined &&
      isSameUrlStateValue(currentValue, defaultValue)
    ) {
      return false;
    }

    return true;
  });

  return Object.fromEntries(entries) as Partial<T>;
}

function mergeUrlState<T extends UrlStateRecord>(
  defaults: T,
  search: Partial<T>,
): T {
  const nextState = { ...defaults };

  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined) {
      nextState[key as keyof T] = value as T[keyof T];
    }
  }

  return nextState;
}

export function useUrlState<T extends UrlStateRecord>(
  from: string,
  search: Partial<T>,
  defaults: T,
) {
  const navigate = useNavigate();

  const state = useMemo(
    () => mergeUrlState(defaults, search),
    [defaults, search],
  );

  const setState = useCallback(
    (updates: Partial<T>) => {
      const nextState = { ...state, ...updates } as T;

      navigate({
        to: from,
        search: sanitizeUrlState(nextState, defaults) as T,
        replace: false,
        resetScroll: false,
      });
    },
    [defaults, from, navigate, state],
  );

  const resetState = useCallback(
    (keys: (keyof T)[]) => {
      const nextState = { ...state };

      for (const key of keys) {
        nextState[key] = defaults[key];
      }

      navigate({
        to: from,
        search: sanitizeUrlState(nextState, defaults) as T,
        replace: false,
        resetScroll: false,
      });
    },
    [defaults, from, navigate, state],
  );

  return { state, setState, resetState };
}
