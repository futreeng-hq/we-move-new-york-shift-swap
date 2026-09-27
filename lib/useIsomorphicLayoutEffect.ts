import { useEffect, useLayoutEffect } from "react";

/**
 * useLayoutEffect on the client, useEffect on the server.
 *
 * Plain useLayoutEffect logs a warning during server rendering because it
 * cannot run there. The distinction matters where an effect corrects
 * browser-only state that the server could not know (sessionStorage, the query
 * string): a layout effect applies before the browser paints, so the correction
 * is invisible, while useEffect lands after paint and the user sees a flash of
 * the server's guess.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
