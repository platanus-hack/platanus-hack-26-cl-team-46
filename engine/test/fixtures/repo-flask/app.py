from flask import Flask, jsonify
app = Flask(__name__)

@app.route('/api/items/<id>')
def get_item(id):
    cur.execute(f"SELECT * FROM items WHERE id = {id}")
    return jsonify(cur.fetchone())

@app.route('/login', methods=['POST'])
def login():
    return jsonify(ok=True)
