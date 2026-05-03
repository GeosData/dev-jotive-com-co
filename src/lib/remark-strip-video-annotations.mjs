import { visit } from 'unist-util-visit';

/**
 * Remark plugin que elimina annotations de guion video del render HTML.
 * Permite que el mismo .md sirva como blog publicable + guion video.
 *
 * Annotations soportadas (case-sensitive):
 *   [B-ROLL: ...]
 *   [CAMERA: ...]
 *   [CUT TO: ...]
 *   [OVERLAY: ...]
 *   [NOTE: ...]
 *
 * Uso: en astro.config.mjs:
 *   markdown: { remarkPlugins: [remarkStripVideoAnnotations] }
 *
 * Ref: Memory/reference_post_video_dual.md
 */
export function remarkStripVideoAnnotations() {
  const annotationPattern = /\[(B-ROLL|CAMERA|CUT TO|OVERLAY|NOTE):\s*[^\]]*\]/g;

  return (tree) => {
    visit(tree, 'paragraph', (node, index, parent) => {
      // Si el paragraph entero es solo una annotation (text nodes only matching pattern), eliminar todo el paragraph
      if (node.children.length === 1 && node.children[0].type === 'text') {
        const text = node.children[0].value.trim();
        if (annotationPattern.test(text) && text.replace(annotationPattern, '').trim() === '') {
          parent.children.splice(index, 1);
          return [visit.SKIP, index];
        }
      }
      // Si paragraph contiene annotation inline, limpiar solo la annotation conservando el resto
      visit(node, 'text', (textNode) => {
        if (textNode.value && annotationPattern.test(textNode.value)) {
          textNode.value = textNode.value.replace(annotationPattern, '').replace(/\s+/g, ' ').trim();
        }
      });
    });
  };
}
