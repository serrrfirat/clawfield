export interface RegistryEntry {
  id: string;
  name: string;
  category: string;
  bounds: { sizeX: number; sizeY: number; sizeZ: number };
  voxelCount: number;
  componentPath: string;
}

export interface Registry {
  version: number;
  components: RegistryEntry[];
}

export interface ComponentFile {
  name: string;
  version: number;
  bounds: { sizeX: number; sizeY: number; sizeZ: number };
  origin: { x: number; y: number; z: number };
  palette: { r: number; g: number; b: number }[];
  usedColors: number[];
  voxels: { x: number; y: number; z: number; c: number }[];
}

export class ComponentBrowser {
  private registry: Registry | null = null;
  private container: HTMLDivElement;
  private searchInput!: HTMLInputElement;
  private listContainer!: HTMLDivElement;
  private selectedId: string | null = null;
  private onSelect: (id: string) => void;

  // Group components by category prefix
  private groups = new Map<string, RegistryEntry[]>();

  // Cache loaded components
  private componentCache = new Map<string, ComponentFile>();

  constructor(container: HTMLDivElement, onSelect: (id: string) => void) {
    this.container = container;
    this.onSelect = onSelect;
  }

  async init(): Promise<void> {
    try {
      const resp = await fetch('/assets/components/registry.json');
      this.registry = await resp.json() as Registry;
    } catch {
      this.container.innerHTML = '<div style="padding:12px;color:#e74c3c">Failed to load registry.json</div>';
      return;
    }

    // Group by category derived from id path
    this.groups.clear();
    for (const comp of this.registry.components) {
      const parts = comp.id.split('/');
      const category = parts.length > 1 ? parts[0] : 'other';
      let group = this.groups.get(category);
      if (!group) {
        group = [];
        this.groups.set(category, group);
      }
      group.push(comp);
    }

    this.buildUI();
  }

  private buildUI(): void {
    this.container.innerHTML = '';

    // Search
    const searchDiv = document.createElement('div');
    searchDiv.className = 'editor-search';
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.placeholder = 'Search components...';
    this.searchInput.addEventListener('input', () => this.filterList());
    searchDiv.appendChild(this.searchInput);
    this.container.appendChild(searchDiv);

    // List
    this.listContainer = document.createElement('div');
    this.container.appendChild(this.listContainer);
    this.renderList('');
  }

  private renderList(filter: string): void {
    this.listContainer.innerHTML = '';
    const lowerFilter = filter.toLowerCase();

    for (const [category, entries] of this.groups) {
      const matching = entries.filter((e) =>
        e.id.toLowerCase().includes(lowerFilter) || e.name.toLowerCase().includes(lowerFilter)
      );
      if (matching.length === 0) continue;

      const section = document.createElement('div');
      section.className = 'editor-sidebar-section';

      const title = document.createElement('div');
      title.className = 'editor-sidebar-section-title';
      title.innerHTML = `${category} <span style="font-size:10px;opacity:0.6">${matching.length}</span>`;
      let collapsed = false;
      const itemsDiv = document.createElement('div');

      title.addEventListener('click', () => {
        collapsed = !collapsed;
        itemsDiv.style.display = collapsed ? 'none' : '';
      });

      section.appendChild(title);

      for (const entry of matching) {
        const item = document.createElement('div');
        item.className = 'editor-comp-item';
        if (entry.id === this.selectedId) item.classList.add('selected');

        const nameSpan = document.createElement('span');
        nameSpan.className = 'editor-comp-item-name';
        // Show just the name part after category
        const shortName = entry.id.split('/').slice(1).join('/');
        nameSpan.textContent = shortName || entry.name;
        nameSpan.title = entry.id;

        const dimsSpan = document.createElement('span');
        dimsSpan.className = 'editor-comp-item-dims';
        dimsSpan.textContent = `${entry.bounds.sizeX}x${entry.bounds.sizeY}x${entry.bounds.sizeZ}`;

        item.append(nameSpan, dimsSpan);
        item.addEventListener('click', () => {
          this.selectedId = entry.id;
          this.onSelect(entry.id);
          // Update selection visuals
          this.listContainer.querySelectorAll('.editor-comp-item.selected').forEach((el) =>
            el.classList.remove('selected')
          );
          item.classList.add('selected');
        });

        itemsDiv.appendChild(item);
      }

      section.appendChild(itemsDiv);
      this.listContainer.appendChild(section);
    }
  }

  private filterList(): void {
    this.renderList(this.searchInput.value);
  }

  async loadComponent(id: string): Promise<ComponentFile | null> {
    const cached = this.componentCache.get(id);
    if (cached) return cached;

    if (!this.registry) return null;
    const entry = this.registry.components.find((c) => c.id === id);
    if (!entry) return null;

    try {
      const resp = await fetch('/' + entry.componentPath);
      const comp = await resp.json() as ComponentFile;
      this.componentCache.set(id, comp);
      return comp;
    } catch {
      console.warn(`Failed to load component: ${id}`);
      return null;
    }
  }

  getRegistry(): Registry | null {
    return this.registry;
  }

  getEntry(id: string): RegistryEntry | undefined {
    return this.registry?.components.find((c) => c.id === id);
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  clearSelection(): void {
    this.selectedId = null;
    this.listContainer?.querySelectorAll('.editor-comp-item.selected').forEach((el) =>
      el.classList.remove('selected')
    );
  }

  show(): void {
    this.container.style.display = '';
    if (!this.registry) this.init();
  }

  hide(): void {
    this.container.style.display = 'none';
  }
}
