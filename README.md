# td — Personal Task Manager

A lightweight task manager with both a CLI tool and a web UI, built for tracking work and personal tasks with reflections.

## Features

- **CLI tool (`td`)** — fast terminal-based task management
- **Web UI (`td-web.py`)** — browser-based interface with inline editing
- **Two views** — To Do list and Done list
- **Task grouping** — Overdue, Today, This Week, Later + Top Priority
- **Work/Personal separation** — filter and toggle, with subtle visual distinction
- **Categories** — customizable, managed via UI
- **Task types** — Quick, Deep, Meeting
- **Reflections tracking** — log reflections on tasks when completed
- **CSV export** — export filtered views to spreadsheet
- **Bulk operations** — select multiple tasks and move due dates

## Quick Start

### 1. Clone and setup

```bash
git clone https://github.com/mkumku/ToDoList.git
cd ToDoList
cp data-example/*.json data/
pip install -r requirements.txt
```

### 2. Run the web UI

```bash
python3 td-web.py
```

Open http://localhost:5000 in your browser.

### 3. Use the CLI

```bash
# Add to your shell profile:
alias td='~/path/to/ToDoList/td'

# Then use:
td                    # Today's work tasks
td p                  # Today's personal tasks
td a                  # All tasks
td add "Helm: fix the thing" -d Friday
td did 5 -f "easy"
td done               # Today's completed work
td help               # Full command reference
```

## File Structure

```
ToDoList/
├── td                  # CLI tool
├── td-web.py           # Web app (Flask)
├── templates/
│   └── index.html      # Web UI template
├── static/
│   ├── td-web.css      # Styles
│   └── td-web.js       # Frontend logic
├── data/               # Your data (gitignored)
│   ├── todo.json
│   ├── done.json
│   └── categories.json
├── data-example/       # Starter templates
│   ├── todo.json
│   ├── done.json
│   └── categories.json
├── requirements.txt
└── .gitignore
```

## Data Privacy

The `data/` folder is gitignored — your personal tasks never leave your machine. Only the app code and example templates are in the repo.

## Built With

- Python 3 + Flask
- Vanilla HTML/CSS/JS (no frameworks)
- JSON file storage

---

Built with [Claude Code](https://claude.com/claude-code)
