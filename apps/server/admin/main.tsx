import '@jackalope/brand/fonts.css';
import { characterMarkViewBox, characterPaths } from '@jackalope/brand/character';
import { Button, InlineNotice } from '@jackalope/ui';
import {
  Activity,
  ArrowUpRight,
  ChartNoAxesColumn,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Users,
  Wrench,
} from 'lucide-react';
import { Component, type ReactNode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Audience, People, Setup } from './Access';
import { Dashboard, Feedback, Usage } from './Dashboard';
import { Notes } from './Notes';
import './admin.css';

const navigation = [
  ['overview', '/admin', 'Overview', LayoutDashboard],
  ['people', '/admin/access#people', 'People', Users],
  ['activity', '/admin#activity', 'Usage & releases', Activity],
  ['feedback', '/admin#feedback', 'Feedback', MessageSquare],
  ['insights', '/admin/access#insights', 'Audience insights', ChartNoAxesColumn],
  ['notes', '/admin/access#notes', 'Product notes', Mail],
  ['setup', '/admin/access#setup', 'Service setup', Wrench],
] as const;
function locationView() {
  const hash = location.hash.slice(1);
  const view =
    navigation.find(([id]) => id === hash)?.[0] ||
    (location.pathname === '/admin/access' ? 'people' : 'overview');
  return { view, search: location.search };
}
function App() {
  const [route, setRoute] = useState(locationView);
  const [peopleSearch, setPeopleSearch] = useState(location.search);
  const [visited, setVisited] = useState(() => new Set([locationView().view]));
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const navigate = () => {
      const next = locationView();
      setRoute(next);
      if (next.view === 'people') setPeopleSearch(next.search);
      setVisited((previous) => new Set([...previous, next.view]));
      main.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    };
    addEventListener('popstate', navigate);
    addEventListener('hashchange', navigate);
    return () => {
      removeEventListener('popstate', navigate);
      removeEventListener('hashchange', navigate);
    };
  }, []);
  useEffect(() => {
    document.title = `${navigation.find(([id]) => id === route.view)?.[2]} · Jackalope admin`;
  }, [route.view]);
  const views = {
    overview: <Dashboard />,
    people: <People search={peopleSearch} />,
    activity: <Usage />,
    feedback: <Feedback />,
    insights: <Audience />,
    notes: <Notes />,
    setup: <Setup />,
  };
  useEffect(() => {
    const intercept = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target instanceof Element ? event.target.closest('a') : null;
      if (!target || target.target || target.hasAttribute('download')) return;
      const url = new URL(target.href);
      if (
        url.origin === location.origin &&
        ['/admin', '/admin/access'].includes(url.pathname) &&
        url.hash !== '#main'
      ) {
        event.preventDefault();
        history.pushState(null, '', url);
        dispatchEvent(new PopStateEvent('popstate'));
      }
    };
    document.addEventListener('click', intercept);
    return () => document.removeEventListener('click', intercept);
  }, []);
  return (
    <div>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="/admin">
          <svg viewBox={characterMarkViewBox} fill="currentColor" aria-hidden="true">
            <path d={characterPaths.farEar} opacity=".6" />
            <path d={characterPaths.antler} opacity=".8" />
            <path d={characterPaths.nearEar} />
            <path d={characterPaths.head} />
          </svg>
          Jackalope
        </a>
        <div className="eyebrow">Management console</div>
        <nav className="admin-nav" aria-label="Admin navigation">
          {navigation.map(([id, href, title, Icon]) => (
            <a key={id} href={href} aria-current={route.view === id ? 'page' : undefined}>
              <Icon size={19} aria-hidden="true" />
              {title}
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <small>Private workspace</small>
          <a href="https://jackalope.dev" target="_blank" rel="noreferrer">
            Open website <ArrowUpRight size={18} aria-hidden="true" />
          </a>
        </div>
      </aside>
      <main id="main" className="workspace" ref={main} tabIndex={-1}>
        <div className="topbar">
          <span>Jackalope / Admin</span>
          <a href="/cdn-cgi/access/logout">Sign out</a>
        </div>
        {navigation
          .filter(([id]) => visited.has(id))
          .map(([id]) => (
            <section
              key={id}
              hidden={route.view !== id}
              aria-label={navigation.find(([key]) => key === id)?.[2]}
            >
              {views[id]}
            </section>
          ))}
      </main>
    </div>
  );
}
class AdminBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="error-boundary">
        <h1>Admin console unavailable</h1>
        <InlineNotice tone="error">
          The page could not be displayed. Reload to try again.
        </InlineNotice>
        <Button onClick={() => location.reload()}>Reload console</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <AdminBoundary>
      <App />
    </AdminBoundary>,
  );
