import { dequal } from "dequal/lite";
import { useRef } from "react";

/**
 * Returns the previous reference while `value` is deeply equal to it, so
 * inline option objects don't invalidate memos and context values on every
 * parent render. Functions and components compare by identity.
 */
export const useStableValue = <T>(value: T): T => {
  const ref = useRef(value);
  if (!dequal(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
};
