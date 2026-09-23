import { useEffect, useState } from 'react';

const read = () => (document.documentElement.style.colorScheme === 'light' ? 'light' : 'dark');

export function useColorScheme() {
  const [scheme, setScheme] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setScheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);
  return scheme;
}
