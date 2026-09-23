import { animate, useMotionValue, useSpring, useTransform } from 'motion/react';
import { type RefObject, useEffect } from 'react';

export function useMascotIdle(
  element: RefObject<HTMLButtonElement | null>,
  idle: boolean,
  attentive: boolean,
  reducedMotion: boolean,
) {
  const eyeOpen = useMotionValue(1);
  const gazeX = useSpring(0, { stiffness: 100, damping: 24, mass: 0.6 });
  const gazeY = useSpring(0, { stiffness: 100, damping: 24, mass: 0.6 });
  const headX = useTransform(gazeX, (value) => value * 1.2);
  const headY = useTransform(gazeY, (value) => value * 0.8);
  const headRotate = useTransform(gazeY, (value) => value * 2.4);
  const eyeX = useTransform(gazeX, (value) => value * 0.9);
  const eyeY = useTransform(gazeY, (value) => value * 0.6);

  useEffect(() => {
    let blinkAnimation: ReturnType<typeof animate> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let pointer: PointerEvent | undefined;
    let visible = false;
    let focused = document.hasFocus();
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const blink = () => {
      blinkAnimation?.stop();
      eyeOpen.set(1);
      blinkAnimation = animate(eyeOpen, [1, 0.08, 1], {
        duration: 0.22,
        times: [0, 0.4, 1],
        ease: 'easeInOut',
      });
    };
    const active = () => idle && visible && focused && !document.hidden && !reducedMotion;
    const schedule = () => {
      clearTimeout(timer);
      if (!active()) return;
      timer = setTimeout(
        () => {
          if (!active()) return;
          blink();
          schedule();
        },
        3200 + Math.random() * 4600,
      );
    };
    const center = () => {
      pointer = undefined;
      cancelAnimationFrame(frame);
      frame = 0;
      gazeX.set(0);
      gazeY.set(0);
    };
    const refresh = () => {
      schedule();
      if (!active()) {
        center();
        gazeX.jump(0);
        gazeY.jump(0);
        blinkAnimation?.stop();
        eyeOpen.set(1);
      }
    };
    const look = () => {
      frame = 0;
      if (!pointer || !active() || !element.current) return;
      const bounds = element.current.getBoundingClientRect();
      gazeX.set(Math.tanh((pointer.clientX - bounds.left - bounds.width / 2) / 360));
      gazeY.set(Math.tanh((pointer.clientY - bounds.top - bounds.height / 2) / 300));
    };
    const move = (event: PointerEvent) => {
      if (!active() || !finePointer.matches || event.pointerType !== 'mouse') return;
      pointer = event;
      if (!frame) frame = requestAnimationFrame(look);
    };
    const leave = (event: PointerEvent) => {
      if (!event.relatedTarget) center();
    };
    const blur = () => {
      focused = false;
      refresh();
    };
    const focus = () => {
      focused = true;
      refresh();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refresh();
    });
    if (idle && !reducedMotion && element.current) observer.observe(element.current);
    if (attentive && !reducedMotion) blink();
    if (idle && !reducedMotion) {
      window.addEventListener('pointermove', move, { passive: true });
      window.addEventListener('pointerout', leave);
      window.addEventListener('blur', blur);
      window.addEventListener('focus', focus);
      window.addEventListener('scroll', center, true);
      window.addEventListener('resize', center);
      document.addEventListener('visibilitychange', refresh);
      finePointer.addEventListener('change', center);
    }
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      blinkAnimation?.stop();
      eyeOpen.set(1);
      gazeX.jump(0);
      gazeY.jump(0);
      observer.disconnect();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerout', leave);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      window.removeEventListener('scroll', center, true);
      window.removeEventListener('resize', center);
      document.removeEventListener('visibilitychange', refresh);
      finePointer.removeEventListener('change', center);
    };
  }, [element, idle, attentive, reducedMotion, eyeOpen, gazeX, gazeY]);

  return { eyeOpen, headX, headY, headRotate, eyeX, eyeY };
}
