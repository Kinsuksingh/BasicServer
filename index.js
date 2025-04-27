const express = require('express');
const path = require('path');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const dateFns = require('date-fns');
const cors = require('cors');

// Initialize Express app
const port = 3000;
const app = express();

// Enable CORS
app.use(cors());

// Middleware to parse JSON
app.use(express.json());

// SQLite Database Connection
const dbPath = path.join(__dirname, 'todoApplication.db');
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await sqlite.open({ filename: dbPath, driver: sqlite3.Database });
    console.log('Connected to the SQLite database.');
    app.listen(port, () => {
      console.log(`Todo API listening at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Database connection error:', error.message);
    process.exit(1);
  }
};

initializeDBAndServer();

// API Endpoints

// GET all todos with optional query filters
app.get('/todos', async (req, res) => {
  try {
    const { status, priority, category, due_date } = req.query;
    let query = `SELECT * FROM todo WHERE 1=1`;
    const params = [];

    // Validate and format due_date using date-fns
    if (due_date) {
      const parsedDate = dateFns.parse(due_date, 'yyyy-MM-dd', new Date()); // Example format
      if (!dateFns.isValid(parsedDate)) {
        return res.status(400).json({ error: 'Invalid date format. Expected format: yyyy-MM-dd' });
      }
      query += ` AND due_date = ?`;
      params.push(dateFns.format(parsedDate, 'yyyy-MM-dd')); // Format the date before adding to the query
    }

    // Parameterized queries for security
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    if (priority) {
      query += ` AND priority = ?`;
      params.push(priority);
    }
    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }

    console.log("Safe query:", query);
    console.log("Parameters:", params);

    const todos = await db.all(query, params);
    res.json(todos);

  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST a new todo
app.post('/todos', async (req, res) => {
  try {
    const { id, todo, status, priority, category, dueDate } = req.body;

    // Validate required fields (excluding ID)
    if (!todo || !status || !priority || !category) {
      return res.status(400).json({
        error: 'Missing required fields: todo, status, priority, category'
      });
    }

    // Date validation using date-fns
    let formattedDueDate = null;
    if (dueDate) {
      const parsedDate = dateFns.parse(dueDate, 'yyyy-MM-dd', new Date());
      if (!dateFns.isValid(parsedDate)) {
        return res.status(400).json({ error: 'Invalid date format. Expected format: yyyy-MM-dd' });
      }
      formattedDueDate = dateFns.format(parsedDate, 'yyyy-MM-dd'); // Format to store in database
    }

    let query, params;
    if (id) {
      query = `INSERT INTO todo (id, todo, status, priority, category, due_date) VALUES (?, ?, ?, ?, ?, ?)`;
      params = [id, todo, status, priority, category, formattedDueDate];
    } else {
      query = `INSERT INTO todo (todo, status, priority, category, due_date) VALUES (?, ?, ?, ?, ?)`;
      params = [todo, status, priority, category, formattedDueDate];
    }

    // Execute insert
    const result = await db.run(query, params);

    // Return created resource
    const newTodo = await db.get(
      `SELECT * FROM todo WHERE id = ?`,
      [id || result.lastID]
    );

    res.status(201).json(newTodo);

  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'ID already exists' });
    }
    console.error('Create error:', error);
    res.status(500).json({ error: 'Failed to create todo' });
  }
});

// GET a specific todo by ID
app.get('/todos/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Parameterized query
    const todo = await db.get(
      `SELECT * FROM todo WHERE id = ?`,
      [id]
    );

    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    res.json(todo);
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch todo' });
  }
});

// PUT (Update) a specific todo by ID
app.put('/todos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { todo, status, priority, category, due_date } = req.body;

    // Verify todo exists
    const existing = await db.get(
      `SELECT id FROM todo WHERE id = ?`,
      [id]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    // Build dynamic update query
    let updates = [];
    let params = [];

    if (todo !== undefined) {
      updates.push('todo = ?');
      params.push(todo);
    }

    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }

    if (priority !== undefined) {
      updates.push('priority = ?');
      params.push(priority);
    }

    if (category !== undefined) {
      updates.push('category = ?');
      params.push(category);
    }

    // Date validation
    if (due_date !== undefined) {
      const parsedDate = dateFns.parse(due_date, 'yyyy-MM-dd', new Date());
      if (!dateFns.isValid(parsedDate)) {
        return res.status(400).json({ error: 'Invalid date format. Expected format: yyyy-MM-dd' });
      }
      updates.push('due_date = ?');
      params.push(dateFns.format(parsedDate, 'yyyy-MM-dd'));
    }

    // Execute update
    if (updates.length > 0) {
      params.push(id); // Add ID last for WHERE clause
      await db.run(
        `UPDATE todo SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    // Return updated resource
    const updatedTodo = await db.get(
      `SELECT * FROM todo WHERE id = ?`,
      [id]
    );

    res.json(updatedTodo);
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

// DELETE a todo by ID
app.delete('/todos/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.get(
      `SELECT * FROM todo WHERE id = ?`,
      [id]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    await db.run(
      `DELETE FROM todo WHERE id = ?`,
      [id]
    );

    res.status(200).json({
      message: 'Todo deleted successfully',
      deletedTodo: existing
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

// Serve HTML page (example)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'api-flow.html'));
});
