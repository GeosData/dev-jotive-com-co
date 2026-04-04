// Simple i18n client-side store
const STORAGE_KEY = 'jotive-lang';

export function getStoredLang(): 'es' | 'en' {
  if (typeof window === 'undefined') return 'es';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'en' ? 'en' : 'es';
}

export function setStoredLang(lang: 'es' | 'en') {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.setAttribute('data-lang', lang);
  updateContent(lang);
}

function updateContent(lang: 'es' | 'en') {
  // Dispatch custom event for islands/components to listen
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  
  // Simple DOM text replacement for static content
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const text = getTranslation(lang, key);
    if (text) {
      if (el.hasAttribute('data-i18n-attr')) {
        const attr = el.getAttribute('data-i18n-attr') || 'textContent';
        if (attr === 'textContent') el.textContent = text;
        else el.setAttribute(attr, text);
      } else {
        el.textContent = text;
      }
    }
  });
}

// Translation dictionary inline for client-side
const translations: Record<string, Record<'es' | 'en', string>> = {
  'nav.projects': { es: 'Proyectos', en: 'Projects' },
  'nav.blog': { es: 'Blog', en: 'Blog' },
  'nav.back': { es: '← Volver', en: '← Back' },
  'hero.available': { es: 'Disponible para nuevos proyectos', en: 'Available for new projects' },
  'hero.cta': { es: 'Ver proyectos', en: 'View projects' },
  'stack.title': { es: 'Stack', en: 'Stack' },
  'stack.experience': { es: 'Experiencia', en: 'Experience' },
  'stack.familiarity': { es: 'Competente', en: 'Familiar' },
  'stack.knowledge': { es: 'Nociones', en: 'Knowledge' },
  'stack.languages': { es: 'Lenguajes', en: 'Languages' },
  'stack.frameworks': { es: 'Frameworks', en: 'Frameworks' },
  'stack.dataAndAI': { es: 'Datos e IA', en: 'Data & AI' },
  'stack.devops': { es: 'DevOps', en: 'DevOps' },
  'stack.security': { es: 'Seguridad', en: 'Security' },
  'projects.title': { es: 'Proyectos', en: 'Projects' },
  'blog.title': { es: 'Blog', en: 'Blog' },
  'blog.viewAll': { es: 'Ver todos →', en: 'View all →' },
};

export function getTranslation(lang: 'es' | 'en', key: string): string {
  return translations[key]?.[lang] || key;
}

// Initialize
if (typeof window !== 'undefined') {
  document.documentElement.setAttribute('data-lang', getStoredLang());
}
