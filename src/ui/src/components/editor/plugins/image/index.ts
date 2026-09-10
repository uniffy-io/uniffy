import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { nodeViewCtx } from "@milkdown/core";
import { imageBlockSchema } from "@milkdown/kit/component/image-block";
import type { Node } from "@milkdown/prose/model";
import type { EditorView, NodeView } from "@milkdown/prose/view";
import { $view } from "@milkdown/kit/utils";
import { ResizableImage } from "@/components/editor/plugins/image/ResizableImage";

class ImageBlockNodeView implements NodeView {
  readonly dom: HTMLDivElement;
  private readonly root: Root;
  private selected = false;
  private destroyed = false;

  constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "editor-image-block";
    this.dom.contentEditable = "false";
    this.root = createRoot(this.dom);
    this.render();
  }

  private setAttribute = (attribute: "ratio" | "caption", value: number | string) => {
    if (this.destroyed || this.view.isDestroyed || !this.view.editable) return;
    const pos = this.getPos();
    if (pos === undefined) return;
    const current = this.view.state.doc.nodeAt(pos);
    if (current?.type !== this.node.type || current.attrs.src !== this.node.attrs.src) return;
    if (current.attrs[attribute] === value) return;
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, attribute, value));
  };

  private render() {
    this.root.render(
      createElement(ResizableImage, {
        src: this.node.attrs.src as string,
        caption: this.node.attrs.caption as string,
        ratio: this.node.attrs.ratio as number,
        selected: this.selected,
        editable: this.view.editable,
        onScale: (ratio) => this.setAttribute("ratio", ratio),
        onCaption: (caption) => this.setAttribute("caption", caption),
      }),
    );
  }

  update(node: Node) {
    if (node.type !== this.node.type || node.attrs.src !== this.node.attrs.src) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.selected = true;
    this.render();
  }

  deselectNode() {
    this.selected = false;
    this.render();
  }

  stopEvent(event: Event) {
    return (
      event.target instanceof Element &&
      Boolean(event.target.closest('input, button, [role="slider"]'))
    );
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    this.destroyed = true;
    this.root.unmount();
  }
}

// Keep Crepe's upload form and Markdown schema; loaded images use the shared resize controls.
export const imageResizeView = $view(imageBlockSchema.node, (ctx) => {
  const uploadView = ctx.get(nodeViewCtx).find(([name]) => name === imageBlockSchema.node.id)?.[1];
  if (!uploadView) throw new Error("Image upload view must be registered before resizing");

  return (node, view, getPos, decorations, innerDecorations) => {
    if (node.attrs.src) return new ImageBlockNodeView(node, view, getPos);
    const upload = uploadView(node, view, getPos, decorations, innerDecorations);
    return {
      ...upload,
      update: (updatedNode, updatedDecorations, updatedInnerDecorations) => {
        if (updatedNode.attrs.src) return false;
        return upload.update?.(updatedNode, updatedDecorations, updatedInnerDecorations) ?? false;
      },
    };
  };
});
