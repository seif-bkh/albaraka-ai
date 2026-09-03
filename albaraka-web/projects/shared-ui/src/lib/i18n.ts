/** shared-i18n — locales, directions and the UI dictionary (contract: docs/06, specs/openapi Locale). */
export type Locale = 'fr-FR' | 'ar-TN' | 'en-GB';
export const LOCALES: Locale[] = ['fr-FR', 'ar-TN', 'en-GB'];
export const dirOf = (l: Locale): 'ltr' | 'rtl' => (l === 'ar-TN' ? 'rtl' : 'ltr');
export const langName: Record<Locale, string> = { 'fr-FR': 'Français', 'ar-TN': 'العربية', 'en-GB': 'English' };

interface Dict {
  brand: string; brandSub: string; bank: string;
  heroTitle: string; heroSub: string; ask: string; send: string;
  thinking: string; sources: string; disclaimers: string; demo: string;
  feedbackUp: string; feedbackDown: string; offline: string; online: string;
}const fr: Dict = {
  brand: 'المشير', brandSub: 'Al-Mouchir', bank: 'Al Baraka Bank Tunisia',
  heroTitle: 'Votre banque participative, question par question',
  heroSub: 'Réponses aux questions sur nos produits, nos procédures et la finance islamique — à partir de la documentation approuvée.',
  ask: 'Posez votre question…',
  send: 'Envoyer', thinking: 'Réflexion en cours', sources: 'Sources', disclaimers: 'Mentions',
  demo: 'Contenu de démonstration', feedbackUp: 'Utile', feedbackDown: 'Pas clair',
  offline: 'Connexion au service en cours…', online: 'Assistance en ligne',
};
const ar: Dict = {
  brand: 'المشير', brandSub: 'Al-Mouchir', bank: 'بنك البركة تونس',
  heroTitle: 'بنكك التشاركي، سؤالا بعد سؤال',
  heroSub: 'أجوبة عن منتجاتنا وإجراءاتنا وتمويلنا الإسلامي — من الوثائق المعتمدة.',
  ask: 'اطرح سؤالك…', send: 'إرسال', thinking: 'جار التفكير', sources: 'المصادر', disclaimers: 'تنبيهات',
  demo: 'محتوى تجريبي', feedbackUp: 'مفيد', feedbackDown: 'غير واضح',
  offline: 'جار الاتصال بالخدمة…', online: 'المساعدة متاحة',
};
const en: Dict = {
  brand: 'المشير', brandSub: 'Al-Mouchir', bank: 'Al Baraka Bank Tunisia',
  heroTitle: 'Your participatory bank, question by question',
  heroSub: 'Answers about our products, procedures and Islamic finance — from approved documentation.',
  ask: 'Ask your question…', send: 'Send', thinking: 'Thinking…', sources: 'Sources', disclaimers: 'Disclaimers',
  demo: 'Demo content', feedbackUp: 'Helpful', feedbackDown: 'Unclear',
  offline: 'Connecting…', online: 'Assistance online',
};
export const UI: Record<Locale, Dict> = { 'fr-FR': fr, 'ar-TN': ar, 'en-GB': en };

/** minimal safe markdown → HTML (bold, italic, lists, paragraphs) */
export function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = esc(md).split('\n');
  let html = '', list = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      if (!list) { html += '<ul>'; list = true; }
      html += `<li>${line.replace(/^\s*[-*]\s+/, '')}</li>`;
      continue;
    }
    if (list) { html += '</ul>'; list = false; }
    if (!line.trim()) continue;
    const fmt = line
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
    html += `<p>${fmt}</p>`;
  }
  if (list) html += '</ul>';
  return html;
}
