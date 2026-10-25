/** 进入视口时为 [data-reveal] 加上 .in；不支持 IntersectionObserver 时直接全部显示。 */
export function initReveal(): void {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
  );
  items.forEach((el) => io.observe(el));
}
