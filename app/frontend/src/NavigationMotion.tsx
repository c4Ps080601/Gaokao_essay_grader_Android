import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion, useIsPresent } from "motion/react";

function useLiveReducedMotion() {
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(query.matches);
    changed();
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  return reduced;
}

// Quick departure, soft landing; deliberately no constant-speed travel or bounce.
export const settleEase = [0.16, 1, 0.3, 1] as const;
const leaveEase = [0.4, 0, 1, 1] as const;
export function MotionPage({
  children,
  direction = 1,
  panel = false,
}: {
  children: ReactNode;
  direction?: number;
  panel?: boolean;
}) {
  const present = useIsPresent(),
    reduced = useLiveReducedMotion();
  const element = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    if (panel) element.current?.parentElement?.scrollTo(0, 0);
  }, [panel]);
  return (
    <motion.div
      ref={element}
      className={panel ? "motion-panel" : "motion-page"}
      data-motion-state={!present ? "leaving" : moving ? "entering" : "idle"}
      data-reduced-motion={reduced}
      onAnimationStart={() => setMoving(true)}
      onAnimationComplete={() => setMoving(false)}
      inert={!present}
      aria-hidden={!present || undefined}
      custom={direction}
      initial="enter"
      animate="rest"
      exit="leave"
      variants={{
        enter: (d: number) => ({
          x: reduced ? 0 : d * (panel ? 14 : 22),
          opacity: reduced ? 1 : 0.35,
        }),
        rest: {
          x: 0,
          opacity: 1,
          transition: { duration: reduced ? 0 : 0.28, ease: settleEase },
        },
        leave: (d: number) => ({
          x: reduced ? 0 : -d * 8,
          opacity: reduced ? 1 : 0,
          transition: { duration: reduced ? 0 : 0.11, ease: leaveEase },
        }),
      }}
    >
      {children}
    </motion.div>
  );
}
export function MotionOverlay({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const present = useIsPresent();
  return (
    <motion.div
      className={className}
      inert={!present}
      aria-hidden={!present || undefined}
      initial="closed"
      animate="opened"
      exit="closed"
    >
      {children}
    </motion.div>
  );
}
export function useOverlayMotion() {
  const reduced = useLiveReducedMotion();
  return {
    backdrop: { closed: { opacity: 0 }, opened: { opacity: 1 } },
    drawer: {
      closed: {
        x: reduced ? 0 : "-100%",
        opacity: reduced ? 0 : 1,
        transition: { duration: reduced ? 0 : 0.2, ease: leaveEase },
      },
      opened: {
        x: 0,
        opacity: 1,
        transition: { duration: reduced ? 0 : 0.34, ease: settleEase },
      },
    },
    sheet: {
      closed: {
        y: reduced ? 0 : "100%",
        opacity: reduced ? 0 : 1,
        transition: { duration: reduced ? 0 : 0.2, ease: leaveEase },
      },
      opened: {
        y: 0,
        opacity: 1,
        transition: { duration: reduced ? 0 : 0.34, ease: settleEase },
      },
    },
    backdropTransition: { duration: reduced ? 0 : 0.2, ease: settleEase },
  };
}
