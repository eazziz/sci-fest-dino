/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { lazy, Suspense } from 'react';
import DinoGame from './components/DinoGame';
const RunnerGame = lazy(() => import('./components/RunnerGame'));

const App: React.FC = () => {
  return (
    <main className="tv-app">
      {new URLSearchParams(window.location.search).get('game') === 'runner'
        ? <Suspense fallback={<p className="walk-up-prompt">Loading Lane Runner…</p>}><RunnerGame /></Suspense>
        : <DinoGame />}
    </main>
  );
};

export default App;
