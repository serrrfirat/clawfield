import type { ScoreboardEntry } from '@clawfield/shared';

/**
 * Tab-toggled scoreboard overlay showing player KDA stats.
 * Two columns for Alpha (blue) and Bravo (red) teams,
 * sorted by score descending within each team.
 */
export class Scoreboard {
  private container: HTMLDivElement;
  private alphaBody: HTMLTableSectionElement;
  private bravoBody: HTMLTableSectionElement;
  private entries: ScoreboardEntry[] = [];

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'scoreboard';
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      display: none;
      z-index: 300;
      pointer-events: none;
      background: rgba(0, 0, 0, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 16px;
      font-family: monospace;
      color: #fff;
      min-width: 600px;
    `;

    // Title
    const title = document.createElement('div');
    title.textContent = 'SCOREBOARD';
    title.style.cssText = 'text-align:center;font-size:18px;font-weight:bold;letter-spacing:3px;margin-bottom:12px;';
    this.container.appendChild(title);

    // Two-column layout
    const columns = document.createElement('div');
    columns.style.cssText = 'display:flex;gap:16px;';

    // Alpha table
    const alphaWrap = this.createTeamTable('ALPHA', '#3498db');
    this.alphaBody = alphaWrap.tbody;
    columns.appendChild(alphaWrap.div);

    // Bravo table
    const bravoWrap = this.createTeamTable('BRAVO', '#e74c3c');
    this.bravoBody = bravoWrap.tbody;
    columns.appendChild(bravoWrap.div);

    this.container.appendChild(columns);
    document.body.appendChild(this.container);
  }

  private createTeamTable(teamName: string, color: string): { div: HTMLDivElement; tbody: HTMLTableSectionElement } {
    const div = document.createElement('div');
    div.style.cssText = 'flex:1;';

    const header = document.createElement('div');
    header.textContent = teamName;
    header.style.cssText = `color:${color};font-size:14px;font-weight:bold;margin-bottom:6px;letter-spacing:2px;`;
    div.appendChild(header);

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';

    // Header row
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const col of ['Name', 'Class', 'K', 'D', 'A', 'Score']) {
      const th = document.createElement('th');
      th.textContent = col;
      th.style.cssText = 'text-align:left;padding:2px 6px;opacity:0.6;border-bottom:1px solid rgba(255,255,255,0.1);';
      if (['K', 'D', 'A', 'Score'].includes(col)) {
        th.style.textAlign = 'center';
        th.style.width = '40px';
      }
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    div.appendChild(table);

    return { div, tbody };
  }

  /** Update from server scoreboard data */
  updateEntries(entries: ScoreboardEntry[]): void {
    this.entries = entries;
  }

  /** Show/hide based on tab key state */
  setVisible(visible: boolean): void {
    this.container.style.display = visible ? 'block' : 'none';
    if (visible) {
      this.render();
    }
  }

  private render(): void {
    // Sort by score descending
    const alpha = this.entries.filter(e => e.team === 0).sort((a, b) => b.score - a.score);
    const bravo = this.entries.filter(e => e.team === 1).sort((a, b) => b.score - a.score);

    this.renderTeam(this.alphaBody, alpha);
    this.renderTeam(this.bravoBody, bravo);
  }

  private renderTeam(tbody: HTMLTableSectionElement, players: ScoreboardEntry[]): void {
    tbody.innerHTML = '';
    for (const p of players) {
      const tr = document.createElement('tr');
      const vals = [
        this.esc(p.name),
        p.classId.charAt(0).toUpperCase() + p.classId.slice(1),
        String(p.kills),
        String(p.deaths),
        String(p.assists),
        String(p.score),
      ];
      for (let i = 0; i < vals.length; i++) {
        const td = document.createElement('td');
        td.textContent = vals[i]!;
        td.style.cssText = 'padding:3px 6px;';
        if (i >= 2) {
          td.style.textAlign = 'center';
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  private esc(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  dispose(): void {
    this.container.remove();
  }
}
