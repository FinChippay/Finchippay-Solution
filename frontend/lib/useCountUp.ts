import { useState, useEffect, useRef } from 'react';
import { useMotionValue, animate } from 'framer-motion';

export function useCountUp(target: number, duration: number = 2000, startOnView: boolean = true) {
  const [count, setCount] = useState(0);
  const [isVisible, setIsVisible] = useState(!startOnView);
  const [hasAnimated, setHasAnimated] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);
  const motionValue = useMotionValue(0);

  useEffect(() => {
    if (!startOnView) {
      setIsVisible(true);
    } else if (elementRef.current) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !hasAnimated) {
            setIsVisible(true);
            setHasAnimated(true);
          }
        },
        { threshold: 0.1 }
      );

      observer.observe(elementRef.current);
      return () => observer.disconnect();
    }
  }, [startOnView, hasAnimated]);

  useEffect(() => {
    if (!isVisible) return;

    const controls = animate(motionValue, target, {
      duration: duration / 1000,
      onUpdate: (latest) => setCount(Math.floor(latest)),
      ease: "easeOut"
    });

    return controls.stop;
  }, [isVisible, target, duration, motionValue]);

  return { count, elementRef };
}