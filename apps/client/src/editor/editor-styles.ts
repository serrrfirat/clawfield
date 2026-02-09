const CSS = /* css */ `
/* ───────────────── Base ───────────────── */

.editor-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  color: #e0e0e0;
  z-index: 100;
  user-select: none;
  font-size: 13px;
}

.editor-root * {
  pointer-events: auto;
}

/* ───────────────── Toolbar (top) ───────────────── */

.editor-toolbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  background: #1a1a2e;
  border-bottom: 1px solid #333;
  display: flex;
  align-items: center;
  padding: 0 8px;
  gap: 4px;
  z-index: 110;
}

.editor-toolbar-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.editor-toolbar-sep {
  width: 1px;
  height: 24px;
  background: #444;
  margin: 0 8px;
}

.editor-btn {
  background: #2a2a4a;
  border: 1px solid #444;
  color: #e0e0e0;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  border-radius: 3px;
  transition: background 0.15s;
}

.editor-btn:hover {
  background: #3a3a5a;
}

.editor-btn:active {
  background: #4a4a6a;
}

.editor-btn.active {
  background: #4466aa;
  border-color: #5577cc;
}

.editor-btn-icon {
  padding: 4px 8px;
}

/* ───────────────── Sidebar (left) ───────────────── */

.editor-sidebar {
  position: fixed;
  top: 40px;
  left: 0;
  bottom: 28px;
  width: 280px;
  background: #1e1e36;
  border-right: 1px solid #333;
  overflow-y: auto;
  z-index: 105;
  display: flex;
  flex-direction: column;
}

.editor-sidebar-header {
  padding: 8px 12px;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #888;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.editor-sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.editor-sidebar-section {
  border-bottom: 1px solid #2a2a44;
}

.editor-sidebar-section-title {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #6688aa;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.editor-sidebar-section-title:hover {
  background: #2a2a44;
}

/* ───────────────── Search input ───────────────── */

.editor-search {
  padding: 6px 12px;
  flex-shrink: 0;
}

.editor-search input {
  width: 100%;
  background: #2a2a4a;
  border: 1px solid #444;
  color: #e0e0e0;
  padding: 5px 8px;
  font-size: 12px;
  font-family: inherit;
  border-radius: 3px;
  outline: none;
}

.editor-search input:focus {
  border-color: #5577cc;
}

.editor-search input::placeholder {
  color: #666;
}

/* ───────────────── Component list item ───────────────── */

.editor-comp-item {
  padding: 5px 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  border-left: 3px solid transparent;
}

.editor-comp-item:hover {
  background: #2a2a44;
}

.editor-comp-item.selected {
  background: #2a3a5a;
  border-left-color: #5577cc;
}

.editor-comp-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-comp-item-dims {
  color: #888;
  font-size: 10px;
  margin-left: 8px;
  flex-shrink: 0;
}

/* ───────────────── Metadata list ───────────────── */

.editor-meta-item {
  padding: 5px 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.editor-meta-item:hover {
  background: #2a2a44;
}

.editor-meta-item-label {
  font-weight: 500;
}

.editor-meta-item-coords {
  color: #888;
  font-size: 10px;
}

/* ───────────────── Status bar (bottom) ───────────────── */

.editor-status {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 28px;
  background: #1a1a2e;
  border-top: 1px solid #333;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 16px;
  font-size: 11px;
  color: #888;
  z-index: 110;
}

.editor-status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.editor-status-dirty {
  color: #e8a838;
  font-weight: 600;
}

/* ───────────────── Terrain panel ───────────────── */

.editor-panel {
  padding: 12px;
}

.editor-panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.editor-panel-row label {
  font-size: 12px;
  color: #aaa;
}

.editor-panel-row input[type="number"] {
  width: 80px;
  background: #2a2a4a;
  border: 1px solid #444;
  color: #e0e0e0;
  padding: 3px 6px;
  font-size: 12px;
  font-family: inherit;
  border-radius: 3px;
  outline: none;
}

.editor-panel-row input[type="range"] {
  width: 120px;
  accent-color: #5577cc;
}

.editor-panel-row input:focus {
  border-color: #5577cc;
}

.editor-panel-row .value {
  color: #aaa;
  font-size: 11px;
  width: 24px;
  text-align: right;
}

.editor-panel-btn {
  width: 100%;
  margin-top: 8px;
  padding: 8px;
  background: #4466aa;
  border: none;
  color: #fff;
  font-size: 13px;
  font-family: inherit;
  border-radius: 3px;
  cursor: pointer;
  font-weight: 500;
}

.editor-panel-btn:hover {
  background: #5577cc;
}

/* ───────────────── Placement list ───────────────── */

.editor-placement-item {
  padding: 5px 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.editor-placement-item:hover {
  background: #2a2a44;
}

.editor-placement-item.selected {
  background: #2a3a5a;
  border-left: 3px solid #5577cc;
}

/* ───────────────── AI Generate modal ───────────────── */

.editor-ai-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
}

.editor-ai-modal {
  background: #1e1e36;
  border: 1px solid #444;
  border-radius: 8px;
  width: 560px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.editor-ai-header {
  padding: 16px 20px;
  border-bottom: 1px solid #333;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.editor-ai-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #e0e0e0;
}

.editor-ai-close {
  background: none;
  border: none;
  color: #888;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.editor-ai-close:hover {
  color: #e0e0e0;
}

.editor-ai-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.editor-ai-body label {
  font-size: 12px;
  color: #aaa;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.editor-ai-body textarea {
  width: 100%;
  height: 120px;
  background: #2a2a4a;
  border: 1px solid #444;
  color: #e0e0e0;
  padding: 10px;
  font-size: 13px;
  font-family: inherit;
  border-radius: 4px;
  outline: none;
  resize: vertical;
  line-height: 1.5;
}

.editor-ai-body textarea:focus {
  border-color: #5577cc;
}

.editor-ai-body textarea::placeholder {
  color: #666;
}

.editor-ai-footer {
  padding: 16px 20px;
  border-top: 1px solid #333;
  display: flex;
  align-items: center;
  gap: 12px;
}

.editor-ai-generate {
  padding: 8px 24px;
  background: linear-gradient(135deg, #6644cc, #4466cc);
  border: none;
  color: #fff;
  font-size: 13px;
  font-family: inherit;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.editor-ai-generate:hover {
  opacity: 0.9;
}

.editor-ai-generate:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.editor-ai-status {
  font-size: 12px;
  color: #888;
  flex: 1;
}

.editor-ai-status.error {
  color: #e74c3c;
}

.editor-ai-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid #444;
  border-top-color: #6644cc;
  border-radius: 50%;
  animation: editor-spin 0.6s linear infinite;
  margin-right: 6px;
  vertical-align: middle;
}

@keyframes editor-spin {
  to { transform: rotate(360deg); }
}

.editor-ai-btn-toolbar {
  background: linear-gradient(135deg, #6644cc, #4466cc);
  border: 1px solid #7755dd;
  color: #fff;
  font-weight: 600;
}

.editor-ai-btn-toolbar:hover {
  background: linear-gradient(135deg, #7755dd, #5577dd);
}

/* ───────────────── Canvas offset ───────────────── */

.editor-canvas-container {
  position: fixed;
  top: 40px;
  left: 280px;
  right: 0;
  bottom: 28px;
}

/* ───────────────── Scrollbar styling ───────────────── */

.editor-sidebar::-webkit-scrollbar,
.editor-sidebar-content::-webkit-scrollbar {
  width: 6px;
}

.editor-sidebar::-webkit-scrollbar-thumb,
.editor-sidebar-content::-webkit-scrollbar-thumb {
  background: #444;
  border-radius: 3px;
}

.editor-sidebar::-webkit-scrollbar-track,
.editor-sidebar-content::-webkit-scrollbar-track {
  background: transparent;
}
`;

let injected = false;

export function injectEditorStyles(): void {
  if (injected) return;
  injected = true;

  const style = document.createElement('style');
  style.setAttribute('data-editor', '');
  style.textContent = CSS;
  document.head.appendChild(style);
}
