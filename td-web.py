import json
import re
import os
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, render_template

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
TODO_FILE = os.path.join(DATA_DIR, "todo.json")
DONE_FILE = os.path.join(DATA_DIR, "done.json")
CATEGORIES_FILE = os.path.join(DATA_DIR, "categories.json")

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def load_json(path):
    with open(path, "r") as f:
        content = f.read()
    content = re.sub(r',\s*([}\]])', r'\1', content)
    return json.loads(content)


def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def get_next_id(data):
    if not data["tasks"]:
        return 1
    return max(t["id"] for t in data["tasks"]) + 1


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/todo", methods=["GET"])
def get_todo():
    data = load_json(TODO_FILE)
    return jsonify(data["tasks"])


@app.route("/api/todo", methods=["POST"])
def add_todo():
    data = load_json(TODO_FILE)
    task = request.json
    task["id"] = get_next_id(data)
    if task.get("category", "").lower() == "personal":
        task["personal"] = True
    data["tasks"].append(task)
    save_json(TODO_FILE, data)
    return jsonify(task), 201


@app.route("/api/todo/<int:task_id>", methods=["PUT"])
def update_todo(task_id):
    data = load_json(TODO_FILE)
    for t in data["tasks"]:
        if t["id"] == task_id:
            updates = request.json
            for key, value in updates.items():
                if key != "id":
                    t[key] = value
            save_json(TODO_FILE, data)
            return jsonify(t)
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/todo/<int:task_id>", methods=["DELETE"])
def delete_todo(task_id):
    data = load_json(TODO_FILE)
    for i, t in enumerate(data["tasks"]):
        if t["id"] == task_id:
            removed = data["tasks"].pop(i)
            save_json(TODO_FILE, data)
            return jsonify(removed)
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/todo/<int:task_id>/done", methods=["POST"])
def mark_done(task_id):
    todo_data = load_json(TODO_FILE)
    done_data = load_json(DONE_FILE)

    task = None
    for i, t in enumerate(todo_data["tasks"]):
        if t["id"] == task_id:
            task = todo_data["tasks"].pop(i)
            break

    if not task:
        return jsonify({"error": "Task not found"}), 404

    body = request.json or {}
    today = datetime.now().date()

    entry = {
        "id": get_next_id(done_data),
        "category": task.get("category", "Other"),
        "task": task.get("task", ""),
    }
    if task.get("due"):
        entry["due"] = task["due"]
    entry["completedOn"] = today.isoformat()
    entry["date"] = today.isoformat()
    entry["weekDay"] = DAY_NAMES[today.weekday()]
    entry["personal"] = task.get("personal", False) or task.get("category", "").lower() == "personal"
    if body.get("feeling"):
        entry["feeling"] = body["feeling"]

    done_data["tasks"].append(entry)
    save_json(TODO_FILE, todo_data)
    save_json(DONE_FILE, done_data)
    return jsonify(entry), 201


@app.route("/api/done", methods=["GET"])
def get_done():
    data = load_json(DONE_FILE)
    return jsonify(data["tasks"])


@app.route("/api/done", methods=["POST"])
def add_done():
    done_data = load_json(DONE_FILE)
    task = request.json
    task["id"] = get_next_id(done_data)
    today = datetime.now().date()
    task.setdefault("completedOn", today.isoformat())
    task.setdefault("date", today.isoformat())
    task.setdefault("weekDay", DAY_NAMES[today.weekday()])
    task.setdefault("personal", task.get("category", "").lower() == "personal")
    done_data["tasks"].append(task)
    save_json(DONE_FILE, done_data)
    return jsonify(task), 201


@app.route("/api/done/<int:task_id>", methods=["PUT"])
def update_done(task_id):
    data = load_json(DONE_FILE)
    for t in data["tasks"]:
        if t["id"] == task_id:
            updates = request.json
            for key, value in updates.items():
                if key != "id":
                    t[key] = value
            save_json(DONE_FILE, data)
            return jsonify(t)
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/done/<int:task_id>", methods=["DELETE"])
def delete_done(task_id):
    data = load_json(DONE_FILE)
    for i, t in enumerate(data["tasks"]):
        if t["id"] == task_id:
            removed = data["tasks"].pop(i)
            save_json(DONE_FILE, data)
            return jsonify(removed)
    return jsonify({"error": "Task not found"}), 404


def load_categories():
    if os.path.exists(CATEGORIES_FILE):
        return load_json(CATEGORIES_FILE).get("categories", [])
    return []


def save_categories(cats):
    cats.sort(key=lambda c: c["name"].lower())
    save_json(CATEGORIES_FILE, {"categories": cats})


def find_category(cats, name):
    for c in cats:
        if c["name"] == name:
            return c
    return None


@app.route("/api/categories", methods=["GET"])
def get_categories():
    return jsonify(load_categories())


@app.route("/api/categories", methods=["POST"])
def add_category():
    body = request.json
    name = body.get("name", "").strip()
    personal = body.get("personal", False)
    if not name:
        return jsonify({"error": "Name required"}), 400
    cats = load_categories()
    if not find_category(cats, name):
        cats.append({"name": name, "personal": personal})
        save_categories(cats)
    return jsonify(load_categories())


@app.route("/api/categories/<name>", methods=["PUT"])
def rename_category(name):
    body = request.json
    cats = load_categories()
    cat = find_category(cats, name)
    if cat:
        new_name = body.get("name", cat["name"]).strip()
        if "personal" in body:
            cat["personal"] = body["personal"]
        if new_name != name:
            cat["name"] = new_name
            for path in [TODO_FILE, DONE_FILE]:
                data = load_json(path)
                for t in data["tasks"]:
                    if t.get("category") == name:
                        t["category"] = new_name
                save_json(path, data)
        save_categories(cats)
    return jsonify(load_categories())


@app.route("/api/categories/<name>", methods=["DELETE"])
def delete_category(name):
    cats = load_categories()
    cats = [c for c in cats if c["name"] != name]
    save_categories(cats)
    return jsonify(load_categories())


if __name__ == "__main__":
    app.run(debug=True, port=5000)
