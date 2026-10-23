import { THEME_KEY } from "./theme";

/**
 * Applied before React hydrates so a light-theme user does not get a dark
 * flash on every navigation. Kept tiny and dependency-free on purpose. A
 * server component: it is written into the HTML once and never re-rendered in
 * the browser, where React would not run it anyway.
 */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem('${THEME_KEY}')||'system';var r=document.querySelector('.cc-root');if(!r)return;var d=t==='system'?(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):t;r.setAttribute('data-theme',d);}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
