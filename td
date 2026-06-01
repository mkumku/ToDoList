#!/usr/bin/env python3

import json
import sys
import os
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
TODO_FILE = os.path.join(DATA_DIR, "todo.json")
DONE_FILE = os.path.join(DATA_DIR, "done.json")
FEELINGS_FILE = os.path.join(DATA_DIR, "feelings.txt")

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DAY_ABBREV = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]
MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

import re

def load_json(path):
    with open(path, "r") as f:
        content = f.read()
    content = re.sub(r',\s*([}\]])', r'\1', content)
    return json.loads(content)

def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

def today():
    return datetime.now().date()

def parse_date_from_due(due_str):
    if not due_str:
        return None
    clean = due_str.replace(" EOD", "").replace(" first thing", "")
    for fmt in ["%a %Y-%m-%d", "%Y-%m-%d"]:
        try:
            return datetime.strptime(clean, fmt).date()
        except ValueError:
            pass
    parts = clean.split()
    if len(parts) >= 2:
        for fmt in ["%a %Y-%m-%d", "%Y-%m-%d"]:
            try:
                return datetime.strptime(" ".join(parts[:2]) if len(parts[0]) <= 3 else parts[0], fmt).date()
            except ValueError:
                pass
    return None

def resolve_date(text):
    t = today()
    lower = text.lower().strip()

    first_thing = False
    for suffix in ["first thing", "first"]:
        if lower.endswith(suffix):
            first_thing = True
            lower = lower[: -len(suffix)].strip()
            break

    eod = False
    if lower.endswith("eod"):
        eod = True
        lower = lower[:-3].strip()

    result_date = None
    if lower == "today":
        result_date = t
    elif lower == "tomorrow":
        result_date = t + timedelta(days=1)
    else:
        for i, name in enumerate(DAY_NAMES):
            if lower == name.lower() or lower == DAY_ABBREV[i].lower():
                days_ahead = i - t.weekday()
                if days_ahead <= 0:
                    days_ahead += 7
                result_date = t + timedelta(days=days_ahead)
                break

    if result_date is None:
        for fmt in ["%Y-%m-%d"]:
            try:
                result_date = datetime.strptime(lower, fmt).date()
                break
            except ValueError:
                pass

    if result_date is None:
        for fmt in ["%b %d %Y", "%B %d %Y"]:
            try:
                result_date = datetime.strptime(lower, fmt).date()
                break
            except ValueError:
                pass

    if result_date is None:
        for fmt in ["%b %d", "%B %d", "%d %b", "%d %B"]:
            try:
                result_date = datetime.strptime(f"{lower} {t.year}", f"{fmt} %Y").date()
                break
            except ValueError:
                pass

    if result_date is None:
        return text

    day_abbrev = DAY_ABBREV[result_date.weekday()]
    date_str = f"{day_abbrev} {result_date.strftime('%Y-%m-%d')}"
    if first_thing:
        date_str += " first thing"
    elif eod:
        date_str += " EOD"
    return date_str

WORK_TYPES = ["quick", "deep", "meeting"]
WORK_TYPE_ABBREV = {"q": "quick", "d": "deep", "m": "meeting"}

AUTO_QUICK = ["invite", "ask ", "follow up", "ping", "reply", "forward", "send", "share", "check with", "give"]
AUTO_MEETING = ["meeting", "sync", "standup", "retro", "call", "session"]
AUTO_DEEP = ["review", "research", "understand", "learn", "create", "build", "write", "prepare", "prep", "implement", "start"]

def detect_work_type(task_text):
    lower = task_text.lower()
    for kw in AUTO_MEETING:
        if kw in lower:
            return "meeting"
    for kw in AUTO_QUICK:
        if kw in lower:
            return "quick"
    for kw in AUTO_DEEP:
        if kw in lower:
            return "deep"
    return None

def short_type(wtype):
    if not wtype:
        return ""
    return wtype[0].upper()

def get_next_todo_id(data):
    if not data["tasks"]:
        return 1
    return max(t["id"] for t in data["tasks"]) + 1

def get_next_done_id(data):
    if not data["tasks"]:
        return 1
    return max(t["id"] for t in data["tasks"]) + 1

def is_personal(task):
    return task.get("personal", False) or task.get("category", "").lower() == "personal"

def sort_key(task):
    due = task.get("due", "")
    d = parse_date_from_due(due)
    first = 0 if "first thing" in due else 1
    date_val = d if d else datetime(2099, 12, 31).date()
    return (date_val, first, task.get("id", 0))

def short_due(due_str):
    if not due_str:
        return "—"
    d = parse_date_from_due(due_str)
    if not d:
        return due_str
    suffix = ""
    if "first thing" in due_str:
        suffix = " first thing"
    elif "EOD" in due_str:
        suffix = " EOD"
    return f"{MONTH_ABBREV[d.month - 1]} {d.day}{suffix}"

def section_label(name, tasks_in_section):
    if not tasks_in_section:
        return name
    t = today()
    if name in ("Due Today", "Overdue", "Later"):
        return name
    d = parse_date_from_due(tasks_in_section[0].get("due", ""))
    if d and d == t + timedelta(days=1):
        return f"Tomorrow ({DAY_ABBREV[d.weekday()]} {MONTH_ABBREV[d.month - 1]} {d.day})"
    return name

def display_todo(tasks, title=None):
    if not tasks:
        print("No tasks to show.")
        return

    t = today()
    tasks_sorted = sorted(tasks, key=sort_key)

    overdue = []
    due_today = []
    this_week = []
    later = []

    end_of_week = t + timedelta(days=(4 - t.weekday()) if t.weekday() <= 4 else (11 - t.weekday()))

    for task in tasks_sorted:
        d = parse_date_from_due(task.get("due", ""))
        if d is None:
            later.append(task)
        elif d < t:
            overdue.append(task)
        elif d == t:
            due_today.append(task)
        elif d <= end_of_week:
            this_week.append(task)
        else:
            later.append(task)

    if title:
        print(f"\n{title}")

    first_section = [True]
    def print_section(label, items):
        if not items:
            return
        label = section_label(label, items)
        print(f"\n### {label}")
        if first_section[0]:
            print(f"|     |                  |                                                    |      |                  |")
            print(f"| {'#':>3} | {'Category':<16} | {'Task':<50} | {'Type':^4} | {'Due':<16} |")
            print(f"|-----|------------------|----------------------------------------------------|-{'-'*3}-|-{'-'*15}-|")
            first_section[0] = False
        for task in items:
            tid = task["id"]
            cat = task.get("category", "")
            desc = task.get("task", "")
            due = short_due(task.get("due", ""))
            wtype = short_type(task.get("type", ""))
            notes = task.get("notes", "")
            if notes and "must have" in notes.lower():
                desc += " (**must have**)"
            if notes and notes.lower() != "must have":
                desc += " *"
            print(f"|     |                  |                                                    |      |                  |")
            print(f"| {tid:>3} | {cat:<16} | {desc:<50} | {wtype:^4} | {due:<16} |")

    counts = []
    print_section("Overdue", overdue)
    if overdue:
        counts.append(f"{len(overdue)} overdue")
    print_section("Due Today", due_today)
    if due_today:
        counts.append(f"{len(due_today)} today")
    print_section("This Week", this_week)
    if this_week:
        counts.append(f"{len(this_week)} this week")
    print_section("Later", later)
    if later:
        counts.append(f"{len(later)} later")

    print(f"\n{', '.join(counts)}. {len(tasks)} total.")

def display_todo_flat(tasks, title=None):
    if not tasks:
        print("No tasks to show.")
        return

    if title:
        print(f"\n{title}")

    tasks_sorted = sorted(tasks, key=sort_key)
    print(f"\n| {'#':>3} | {'Category':<16} | {'Task':<50} | {'Type':^4} | {'Due':<20} |")
    print(f"|{'---':>4}-|{'-'*17}-|{'-'*51}-|{'-'*5}-|{'-'*21}-|")
    for task in tasks_sorted:
        tid = task["id"]
        cat = task.get("category", "")
        desc = task.get("task", "")
        due = task.get("due", "—")
        wtype = short_type(task.get("type", ""))
        notes = task.get("notes", "")
        if notes and "must have" in notes.lower():
            desc += " (*must have*)"
        print(f"| {tid:>3} | {cat:<16} | {desc:<50} | {wtype:^4} | {due:<20} |")

    print(f"\n{len(tasks)} total.")

def short_date_done(task):
    d = task.get("date", "")
    wd = task.get("weekDay", "")
    if not d:
        return ""
    abbrev = wd[:3] if wd else ""
    parts = d.split("-")
    if len(parts) == 3:
        month = MONTH_ABBREV[int(parts[1]) - 1]
        return f"{abbrev} {month} {int(parts[2])}"
    return d

def print_done_table(tasks, label=None, show_date=False):
    if not tasks:
        return
    if label:
        print(f"\n### {label}")
    if show_date:
        print(f"|     |                  |                                               |            |                           |")
        print(f"| {'#':>3} | {'Category':<16} | {'Task':<45} | {'Date':<10} | {'Feeling':<25} |")
        print(f"|-----|------------------|-----------------------------------------------|------------|---------------------------|")
    else:
        print(f"|     |                  |                                               |                           |")
        print(f"| {'#':>3} | {'Category':<16} | {'Task':<45} | {'Feeling':<25} |")
        print(f"|-----|------------------|-----------------------------------------------|---------------------------|")
    for task in tasks:
        tid = task["id"]
        cat = task.get("category", "")
        desc = task.get("task", "")
        feeling = task.get("feeling", "")
        if show_date:
            date_str = short_date_done(task)
            print(f"|     |                  |                                               |            |                           |")
            print(f"| {tid:>3} | {cat:<16} | {desc:<45} | {date_str:<10} | {feeling:<25} |")
        else:
            print(f"|     |                  |                                               |                           |")
            print(f"| {tid:>3} | {cat:<16} | {desc:<45} | {feeling:<25} |")

def display_done(tasks, title=None, show_date=False):
    if not tasks:
        print("No completed tasks to show.")
        return

    if title:
        print(f"\n{title}")

    work = [t for t in tasks if not is_personal(t)]
    personal = [t for t in tasks if is_personal(t)]

    print_done_table(work, "Work", show_date=show_date)
    print_done_table(personal, "Personal", show_date=show_date)

    parts = []
    if work:
        parts.append(f"{len(work)} work")
    if personal:
        parts.append(f"{len(personal)} personal")
    print(f"\n{' + '.join(parts)} = {len(tasks)} items.")

def parse_last_range(time_filter):
    import re
    m = re.match(r"last (\d+) (days|weeks|months)", time_filter)
    if not m:
        return None
    n = int(m.group(1))
    unit = m.group(2)
    if unit == "days":
        return timedelta(days=n)
    elif unit == "weeks":
        return timedelta(weeks=n)
    elif unit == "months":
        return timedelta(days=n * 30)
    return None

def filter_done_by_time(tasks, time_filter):
    t = today()
    if time_filter == "today":
        return [d for d in tasks if d.get("date") == t.isoformat()]
    elif time_filter == "yesterday":
        y = (t - timedelta(days=1)).isoformat()
        return [d for d in tasks if d.get("date") == y]
    elif time_filter == "tomorrow":
        y = (t + timedelta(days=1)).isoformat()
        return [d for d in tasks if d.get("date") == y]
    elif time_filter == "this week":
        weekday = t.weekday()
        start = t - timedelta(days=weekday)
        end = start + timedelta(days=6)
        return [d for d in tasks if start.isoformat() <= d.get("date", "") <= end.isoformat()]
    elif time_filter.startswith("last "):
        delta = parse_last_range(time_filter)
        if delta:
            start = (t - delta).isoformat()
            end = t.isoformat()
            return [d for d in tasks if start <= d.get("date", "") <= end]
    else:
        target = parse_date_from_due(time_filter)
        if target:
            return [d for d in tasks if d.get("date") == target.isoformat()]
    return tasks

def resolve_time_filter(args):
    i = 0
    time_filter = None
    remaining = []
    while i < len(args):
        lower = args[i].lower()
        if lower in ("today", "yesterday", "tomorrow"):
            time_filter = lower
        elif lower == "this" and i + 1 < len(args) and args[i + 1].lower() == "week":
            time_filter = "this week"
            i += 1
        elif lower == "last" and i + 2 < len(args):
            try:
                n = int(args[i + 1])
                unit = args[i + 2].lower().rstrip("s")
                if unit in ("day", "week", "month"):
                    time_filter = f"last {n} {unit}s"
                    i += 2
                else:
                    remaining.append(args[i])
            except ValueError:
                remaining.append(args[i])
        else:
            resolved = resolve_date(args[i])
            if resolved != args[i]:
                time_filter = resolved
            else:
                remaining.append(args[i])
        i += 1
    return time_filter, remaining

def filter_todo_by_time(tasks, time_filter):
    t = today()
    if time_filter == "today":
        return [task for task in tasks if (parse_date_from_due(task.get("due", "")) or datetime(2099,1,1).date()) <= t]
    elif time_filter == "tomorrow":
        target = t + timedelta(days=1)
        return [task for task in tasks if parse_date_from_due(task.get("due", "")) == target]
    elif time_filter == "yesterday":
        target = t - timedelta(days=1)
        return [task for task in tasks if parse_date_from_due(task.get("due", "")) == target]
    elif time_filter == "this week":
        weekday = t.weekday()
        start = t - timedelta(days=weekday)
        end = start + timedelta(days=6)
        return [task for task in tasks if start <= (parse_date_from_due(task.get("due", "")) or datetime(2099,1,1).date()) <= end]
    else:
        target = parse_date_from_due(time_filter)
        if target:
            return [task for task in tasks if parse_date_from_due(task.get("due", "")) == target]
    return tasks

def cmd_do(args):
    data = load_json(TODO_FILE)
    tasks = data["tasks"]

    show_personal = False
    show_work = False
    show_all = False
    category_filter = None
    time_filter = None

    time_filter, remaining = resolve_time_filter(args)

    for arg in remaining:
        lower = arg.lower()
        if lower == "all":
            show_all = True
        elif lower in ("personal", "p") and not show_all:
            show_personal = True
        elif lower == "work" and not show_all:
            show_work = True
        else:
            category_filter = lower

    if category_filter:
        filtered = [t for t in tasks if t.get("category", "").lower() == category_filter]
    elif show_all:
        filtered = tasks
    elif show_personal:
        filtered = [t for t in tasks if is_personal(t)]
    elif show_work:
        filtered = [t for t in tasks if not is_personal(t)]
    else:
        filtered = [t for t in tasks if not is_personal(t)]

    if time_filter:
        filtered = filter_todo_by_time(filtered, time_filter)

    hidden_personal = len([t for t in tasks if is_personal(t)]) if not show_all and not show_personal and not category_filter else 0
    if show_work:
        hidden_personal = len([t for t in tasks if is_personal(t)])
    t = today()
    title = f"To Do List (Today: {DAY_ABBREV[t.weekday()]} {t.strftime('%Y-%m-%d')})"
    if time_filter:
        display_todo_flat(filtered, title)
    else:
        display_todo(filtered, title)
    if hidden_personal > 0 and not time_filter:
        print(f"({hidden_personal} personal tasks hidden)")

def cmd_done(args):
    data = load_json(DONE_FILE)
    tasks = data["tasks"]

    show_personal = False
    show_work = False
    show_all = False
    category_filter = None
    limit = None

    time_filter, remaining = resolve_time_filter(args)

    for arg in remaining:
        lower = arg.lower()
        if lower in ("personal", "p"):
            show_personal = True
        elif lower == "work":
            show_work = True
        elif lower == "all":
            show_all = True
        else:
            try:
                limit = int(arg)
            except ValueError:
                category_filter = lower

    if category_filter and time_filter is None:
        filtered = [t for t in tasks if t.get("category", "").lower() == category_filter]
    elif show_all and time_filter is None:
        if limit:
            filtered = tasks[-limit:]
        else:
            filtered = tasks
    else:
        if time_filter is None:
            time_filter = "today"
        filtered = filter_done_by_time(tasks, time_filter)
        if show_personal:
            filtered = [t for t in filtered if is_personal(t)]
        elif show_work:
            filtered = [t for t in filtered if not is_personal(t)]
        elif category_filter:
            filtered = [t for t in filtered if t.get("category", "").lower() == category_filter]

    t = today()
    if category_filter and time_filter is None:
        label = f"All {category_filter.title()}"
    elif time_filter:
        label = time_filter.title()
    elif show_all and limit:
        label = f"Last {limit}"
    else:
        label = "All"
    multi_day = category_filter and time_filter is None or time_filter in ("this week",) or (time_filter and time_filter.startswith("last ")) or (show_all and time_filter is None)
    title = f"Done ({label}) — {DAY_ABBREV[t.weekday()]} {t.strftime('%Y-%m-%d')}"
    display_done(filtered, title, show_date=multi_day)

def extract_flag(raw, flag):
    if f" {flag} " in raw:
        parts = raw.split(f" {flag} ", 1)
        return parts[0], parts[1].strip().strip('"').strip("'")
    return raw, None

def cmd_add(args):
    raw = " ".join(args)

    due = None
    link = None
    work_type = None

    if " -t " in raw:
        raw, t_val = extract_flag(raw, "-t")
        remaining = ""
        if t_val and " -" in t_val:
            first_flag = t_val.index(" -")
            remaining = t_val[first_flag:]
            t_val = t_val[:first_flag].strip()
        t_lower = t_val.lower().strip() if t_val else ""
        work_type = WORK_TYPE_ABBREV.get(t_lower, t_lower if t_lower in WORK_TYPES else None)
        if remaining:
            raw = raw + remaining

    if " -l " in raw:
        parts = raw.split(" -l ", 1)
        raw = parts[0]
        link = parts[1].strip().strip('"').strip("'")
        if " -d " in link:
            link, d_part = link.split(" -d ", 1)
            link = link.strip()
            due = resolve_date(d_part.strip().strip('"').strip("'"))
    if " -d " in raw:
        parts = raw.split(" -d ", 1)
        raw = parts[0]
        d_part = parts[1].strip().strip('"').strip("'")
        if " -l " in d_part:
            d_part, link = d_part.split(" -l ", 1)
            link = link.strip().strip('"').strip("'")
        due = resolve_date(d_part)

    raw = raw.strip().strip('"').strip("'")

    if not due:
        words = raw.split()
        for n in (3, 2, 1):
            if len(words) > n:
                tail = " ".join(words[-n:])
                resolved = resolve_date(tail)
                if resolved != tail:
                    due = resolved
                    raw = " ".join(words[:-n]).strip()
                    break

    if ":" in raw:
        category, task = raw.split(":", 1)
        category = category.strip()
        task = task.strip()
    else:
        category = "Other"
        task = raw

    if category.lower() == "p":
        category = "Personal"

    if not work_type:
        work_type = detect_work_type(task)

    data = load_json(TODO_FILE)
    new_id = get_next_todo_id(data)
    entry = {
        "id": new_id,
        "category": category,
        "task": task,
    }
    if due:
        entry["due"] = due
    if work_type:
        entry["type"] = work_type
    if link:
        entry["notes"] = link
    if category.lower() == "personal":
        entry["personal"] = True

    data["tasks"].append(entry)
    save_json(TODO_FILE, data)
    type_msg = f" [{work_type}]" if work_type else ""
    print(f"Added #{new_id}: \"{task}\" ({category}){type_msg}{' due ' + due if due else ''}{' [link]' if link else ''}")

def cmd_did(args):
    raw = " ".join(args)

    feeling = None
    if " -f " in raw:
        parts = raw.split(" -f ", 1)
        raw = parts[0].strip()
        feeling = parts[1].strip().strip('"').strip("'")

    raw = raw.strip().strip('"').strip("'")

    # Check if it starts with a number (e.g., "13, easy" or "13")
    first_token = raw.split(",")[0].split()[0] if raw else ""
    try:
        task_id = int(first_token)
        # Extract feeling from remainder: "13, easy" or "13 easy"
        remainder = raw[len(first_token):].lstrip(",").strip()
        if remainder and not feeling:
            feeling = remainder
        _finish_task(task_id, feeling)
    except ValueError:
        _log_done(raw, feeling)

def _finish_task(task_id, feeling):
    todo_data = load_json(TODO_FILE)
    done_data = load_json(DONE_FILE)

    task = None
    for i, t in enumerate(todo_data["tasks"]):
        if t["id"] == task_id:
            task = todo_data["tasks"].pop(i)
            break

    if not task:
        print(f"Task #{task_id} not found in to-do list.")
        return

    t = today()
    entry = {
        "id": get_next_done_id(done_data),
        "category": task.get("category", "Other"),
        "task": task.get("task", ""),
    }
    if task.get("due"):
        entry["due"] = task["due"]
    entry["completedOn"] = t.isoformat()
    entry["date"] = t.isoformat()
    entry["weekDay"] = DAY_NAMES[t.weekday()]
    entry["personal"] = is_personal(task)
    if feeling:
        entry["feeling"] = feeling

    done_data["tasks"].append(entry)
    save_json(TODO_FILE, todo_data)
    save_json(DONE_FILE, done_data)
    print(f"Done #{task_id}: \"{task.get('task', '')}\" ({task.get('category', '')})")

FEELING_KEYWORDS_DEFAULT = ["hard", "painful", "annoying", "easy", "ok", "interesting",
                     "fun", "pleasant", "boring", "challenging", "great", "nice",
                     "good", "bad", "stressful", "relaxing", "effortless", "quick",
                     "short", "amazing", "terrible", "awful", "fine", "meh",
                     "tiring", "tired", "long", "slow", "fast", "rough",
                     "satisfying", "rewarding", "frustrating", "confusing",
                     "exciting", "dull", "tedious", "smooth", "productive"]

def load_feelings():
    words = list(FEELING_KEYWORDS_DEFAULT)
    if os.path.exists(FEELINGS_FILE):
        with open(FEELINGS_FILE, "r") as f:
            for line in f:
                w = line.strip().lower()
                if w and w not in words:
                    words.append(w)
    return words

FEELING_KEYWORDS = load_feelings()

def _split_feeling(task_text):
    if "," not in task_text:
        return task_text, None
    last_comma = task_text.rfind(",")
    candidate = task_text[last_comma + 1:].strip()
    if len(candidate) < 30 and len(candidate.split()) < 6:
        first_word = candidate.split()[0].lower().rstrip("!.,") if candidate else ""
        if first_word in FEELING_KEYWORDS or any(kw in candidate.lower() for kw in FEELING_KEYWORDS):
            return task_text[:last_comma].strip(), candidate
    return task_text, None

def _log_done(raw, feeling):
    if ":" in raw:
        category, task = raw.split(":", 1)
        category = category.strip()
        task = task.strip()
    else:
        category = "Other"
        task = raw

    if category.lower() == "p":
        category = "Personal"

    if not feeling:
        task, feeling = _split_feeling(task)

    done_data = load_json(DONE_FILE)
    t = today()
    entry = {
        "id": get_next_done_id(done_data),
        "category": category,
        "task": task,
        "completedOn": t.isoformat(),
        "date": t.isoformat(),
        "weekDay": DAY_NAMES[t.weekday()],
        "personal": category.lower() == "personal",
    }
    if feeling:
        entry["feeling"] = feeling

    done_data["tasks"].append(entry)
    save_json(DONE_FILE, done_data)
    feel_msg = f" ({feeling})" if feeling else ""
    print(f"Logged done: \"{task}\" ({category}){feel_msg}")

def cmd_mv(args):
    if len(args) < 2:
        print("Usage: td mv <id>[,<id>,...] <due>")
        return

    task_ids = []
    due_start = 0
    for i, arg in enumerate(args):
        tokens = [t.strip() for t in arg.split(",") if t.strip()]
        all_numeric = all(t.isdigit() for t in tokens) if tokens else False
        if all_numeric:
            task_ids.extend(int(t) for t in tokens)
            due_start = i + 1
        else:
            break

    if not task_ids:
        print("No valid task IDs provided.")
        return

    if due_start >= len(args):
        print("No due date provided.")
        return

    due = resolve_date(" ".join(args[due_start:]).strip('"').strip("'"))

    data = load_json(TODO_FILE)
    moved = []
    not_found = []
    for task_id in task_ids:
        found = False
        for task in data["tasks"]:
            if task["id"] == task_id:
                task["due"] = due
                moved.append(task_id)
                found = True
                break
        if not found:
            not_found.append(task_id)

    if moved:
        save_json(TODO_FILE, data)
        ids_str = ", ".join(f"#{tid}" for tid in moved)
        print(f"Moved {ids_str} to {due}")
    for tid in not_found:
        print(f"Task #{tid} not found.")

def cmd_top(args):
    if not args:
        print("Usage: td top <id>[,<id>,...] [<due>]")
        return

    task_ids = []
    due_start = 0
    for i, arg in enumerate(args):
        tokens = [t.strip() for t in arg.split(",") if t.strip()]
        all_numeric = all(t.isdigit() for t in tokens) if tokens else False
        if all_numeric:
            task_ids.extend(int(t) for t in tokens)
            due_start = i + 1
        else:
            break

    if not task_ids:
        print("No valid task IDs provided.")
        return

    if due_start < len(args):
        due_raw = " ".join(args[due_start:]).strip('"').strip("'")
    else:
        due_raw = "tomorrow"

    due_raw = due_raw.replace(" first thing", "").replace(" first", "").replace(" EOD", "")
    due = resolve_date(due_raw + " first")

    data = load_json(TODO_FILE)
    moved = []
    not_found = []
    for task_id in task_ids:
        found = False
        for task in data["tasks"]:
            if task["id"] == task_id:
                task["due"] = due
                task["notes"] = "must have"
                moved.append(task_id)
                found = True
                break
        if not found:
            not_found.append(task_id)

    if moved:
        save_json(TODO_FILE, data)
        ids_str = ", ".join(f"#{tid}" for tid in moved)
        print(f"Top priority: {ids_str} -> {due} (must have)")
    for tid in not_found:
        print(f"Task #{tid} not found.")

def cmd_note(args):
    if len(args) < 2:
        print("Usage: td note <id> <text>")
        return

    try:
        task_id = int(args[0])
    except ValueError:
        print(f"Invalid task ID: {args[0]}")
        return

    note_text = " ".join(args[1:]).strip('"').strip("'")

    data = load_json(TODO_FILE)
    for task in data["tasks"]:
        if task["id"] == task_id:
            task["notes"] = note_text
            save_json(TODO_FILE, data)
            print(f"Added note to #{task_id}: \"{note_text}\"")
            return

    print(f"Task #{task_id} not found.")

def cmd_show(args):
    if not args:
        print("Usage: td show <id>")
        return

    try:
        task_id = int(args[0])
    except ValueError:
        print(f"Invalid task ID: {args[0]}")
        return

    data = load_json(TODO_FILE)
    for task in data["tasks"]:
        if task["id"] == task_id:
            print(f"  #{task['id']}  {task.get('category', '')}: {task.get('task', '')}")
            if task.get("due"):
                print(f"  Due:   {task['due']}")
            if task.get("notes"):
                print(f"  Notes: {task['notes']}")
            return

    data = load_json(DONE_FILE)
    for task in data["tasks"]:
        if task["id"] == task_id:
            print(f"  #{task['id']}  {task.get('category', '')}: {task.get('task', '')}  [done]")
            if task.get("due"):
                print(f"  Due:       {task['due']}")
            if task.get("completedOn"):
                print(f"  Completed: {task['completedOn']}")
            if task.get("feeling"):
                print(f"  Feeling:   {task['feeling']}")
            if task.get("notes"):
                print(f"  Notes:     {task['notes']}")
            return

    print(f"Task #{task_id} not found.")

def cmd_feel(args):
    if len(args) < 2:
        print("Usage: td feel <done_id> <feeling>")
        return

    try:
        task_id = int(args[0])
    except ValueError:
        print(f"Invalid task ID: {args[0]}")
        return

    feeling = " ".join(args[1:]).strip('"').strip("'")

    data = load_json(DONE_FILE)
    for task in data["tasks"]:
        if task["id"] == task_id:
            task["feeling"] = feeling
            save_json(DONE_FILE, data)
            print(f"Updated #{task_id} feeling: \"{feeling}\"")
            return

    print(f"Task #{task_id} not found in done list.")

def cmd_feelings(args):
    if not args:
        print("Current feeling keywords:")
        print(", ".join(FEELING_KEYWORDS))
        return

    word = args[0].lower().strip()
    if word in FEELING_KEYWORDS:
        print(f"\"{word}\" is already in the list.")
        return

    with open(FEELINGS_FILE, "a") as f:
        f.write(word + "\n")
    FEELING_KEYWORDS.append(word)
    print(f"Added \"{word}\" to feelings list.")

def cmd_rm(args):
    if not args:
        print("Usage: td rm <id>  (removes from to-do)\n       td rm done <id>  (removes from done)")
        return

    from_done = False
    if args[0].lower() == "done":
        from_done = True
        args = args[1:]

    if not args:
        print("Usage: td rm done <id>")
        return

    try:
        task_id = int(args[0])
    except ValueError:
        print(f"Invalid task ID: {args[0]}")
        return

    path = DONE_FILE if from_done else TODO_FILE
    data = load_json(path)

    for i, t in enumerate(data["tasks"]):
        if t["id"] == task_id:
            removed = data["tasks"].pop(i)
            save_json(path, data)
            source = "done" if from_done else "to-do"
            print(f"Removed #{task_id} from {source}: \"{removed.get('task', '')}\"")
            return

    source = "done" if from_done else "to-do"
    print(f"Task #{task_id} not found in {source} list.")

def cmd_renum(args):
    data = load_json(TODO_FILE)
    for i, task in enumerate(data["tasks"], start=1):
        task["id"] = i
    save_json(TODO_FILE, data)
    print(f"Renumbered {len(data['tasks'])} tasks (1-{len(data['tasks'])})")

def cmd_help():
    print("""td — To Do List CLI

USAGE:
  td                                    Today's work tasks
  td p                                  Today's personal tasks
  td a                                  All tasks (work + personal, all dates)

SHOW TO-DO:
  td do                                 Work tasks (hides personal)
  td do personal                        Personal tasks only
  td do work                            Same as td do
  td do all                             Everything
  td do <category>                      Filter by category (e.g., td do helm)

SHOW DONE:
  td done                               Today's work
  td done today                         Today's work
  td done yesterday                     Yesterday's work
  td done personal                      Today's personal
  td done work today                    Today's work
  td done personal yesterday            Yesterday's personal
  td done personal this week            Personal this week
  td done work this week                Work this week
  td done <category>                    Filter by category
  td done <category> today              Category + time filter

ADD TO-DO:
  td add "Helm: fix the thing" -d Friday
  td add "oc-mirror: prep meeting" -d tomorrow -t deep
  td add "Personal: buy groceries" -d "May 20"
  td add "BU: standup" -d "Friday first" -t meeting
  Type is auto-detected if not set. Values: quick (q), deep (d), meeting (m)
  Type column: Q=quick, D=deep, M=meeting

MARK DONE / LOG DONE:
  td did 5 -f "easy with AI"            Mark existing task #5 as done
  td did 5                               Same, no feeling
  td did "Helm: release notes" -f "easy" Log new completed item
  td did "Personal: walk dog" -f "fun"   Personal items auto-detected

MOVE DUE DATE:
  td mv 5 Friday
  td mv 1,3,5 Friday                    Move multiple tasks
  td mv 5 tomorrow
  td mv 5 "May 20"
  td mv 5 "tomorrow first"

TOP PRIORITY:
  td top 5                               Must have, first thing tomorrow
  td top 5 Friday                        Must have, first thing Friday
  td top 1,3,5 tomorrow                  Multiple tasks

SHOW TASK DETAILS:
  td show 5                              Show full details (notes, links, etc.)

ADD TO-DO WITH LINK:
  td add "Helm: review PR" -d Friday -l "https://github.com/..."

ADD/UPDATE FEELING:
  td feel 88 "fun"                       Add or update feeling on done item #88
  (or just use a comma: td did "Helm: fix thing, easy")

ADD NOTES:
  td note 5 "Must have"

REMOVE:
  td rm 5                                Remove task #5 from to-do list
  td rm done 5                           Remove item #5 from done list

RENUMBER:
  td renum                              Reassign IDs 1, 2, 3, ...

HELP:
  td help / td -h / td --help

DATE OPTIONS:
  today, tomorrow, Monday-Sunday, "May 20", "2026-05-20"
  Suffixes: EOD, first (e.g., "Friday EOD", "tomorrow first")""")

def main():
    args = sys.argv[1:]

    if not args:
        cmd_do(["today"])
        return

    cmd = args[0].lower()

    if cmd in ("help", "-h", "--help"):
        cmd_help()
    elif cmd == "do":
        cmd_do(args[1:])
    elif cmd == "done":
        cmd_done(args[1:])
    elif cmd == "add" and len(args) > 1 and args[1].lower() == "done":
        cmd_did(args[2:])
    elif cmd == "add":
        cmd_add(args[1:])
    elif cmd == "did":
        cmd_did(args[1:])
    elif cmd == "mv":
        cmd_mv(args[1:])
    elif cmd == "top":
        cmd_top(args[1:])
    elif cmd == "note":
        cmd_note(args[1:])
    elif cmd == "show":
        cmd_show(args[1:])
    elif cmd == "feel":
        cmd_feel(args[1:])
    elif cmd == "feelings":
        cmd_feelings(args[1:])
    elif cmd == "rm":
        cmd_rm(args[1:])
    elif cmd == "renum":
        cmd_renum(args[1:])
    elif cmd in ("a", "all"):
        cmd_do(["all"] + args[1:])
    elif cmd == "p":
        cmd_do(["personal", "today"] + args[1:])
    elif cmd in ("today", "tomorrow", "yesterday") or resolve_date(cmd) != cmd:
        cmd_do(["all"] + args)
    else:
        print(f"Unknown command: {cmd}")
        print("Run 'td help' for usage.")

if __name__ == "__main__":
    main()
