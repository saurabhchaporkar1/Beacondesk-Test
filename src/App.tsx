import { useEffect, useState } from 'react';
import { ParticipantView } from './components/ParticipantView';
import { FacilitatorDashboard } from './components/FacilitatorDashboard';

type AppRoute = 'participant' | 'dashboard';

function getRouteFromLocation(): AppRoute {
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.toLowerCase();
  if (
    path.startsWith('/dashboard') ||
    params.get('view') === 'dashboard' ||
    hash === '#dashboard'
  ) {
    return 'dashboard';
  }
  return 'participant';
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => {
    const initial = getRouteFromLocation();
    if (
      initial === 'participant' &&
      window.matchMedia('(display-mode: standalone)').matches &&
      localStorage.getItem('beacondesk_role') === 'facilitator'
    ) {
      return 'dashboard';
    }
    return initial;
  });

  useEffect(() => {
    const handleRouteChange = () => {
      setRoute(getRouteFromLocation());
    };
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      window.removeEventListener('hashchange', handleRouteChange);
    };
  }, []);

  const navigate = (nextRoute: AppRoute) => {
    const targetPath = nextRoute === 'dashboard' ? '/dashboard' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    setRoute(nextRoute);
    window.scrollTo(0, 0);
  };

  if (route === 'dashboard') {
    return <FacilitatorDashboard onNavigateParticipant={() => navigate('participant')} />;
  }

  return <ParticipantView />;
}
