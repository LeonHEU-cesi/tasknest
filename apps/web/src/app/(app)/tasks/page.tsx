'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { TaskTree } from '@/components/task-tree';

// US-ST-02 — Vue minimale projet → liste → arbre de tâches. La List/Kanban
// View polie arrive au Sprint 7 ; ici on expose la décomposition arborescente.
interface Named {
  id: string;
  name: string;
}
interface Task {
  id: string;
  title: string;
  status: string;
  parentTaskId: string | null;
}

export default function TasksPage() {
  const [projects, setProjects] = useState<Named[]>([]);
  const [lists, setLists] = useState<Named[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Named[]>('/projects')
      .then(setProjects)
      .catch(() => setError('Sign in to see your tasks.'));
  }, []);

  const openProject = async (id: string) => {
    setLists(await apiGet<Named[]>(`/projects/${id}/lists`));
    setTasks([]);
  };
  const openList = async (id: string) => {
    setTasks(await apiGet<Task[]>(`/lists/${id}/tasks`));
  };

  if (error) {
    return (
      <main style={pageStyle}>
        <p style={{ color: '#c0392b' }}>{error}</p>
      </main>
    );
  }

  const roots = tasks.filter((t) => t.parentTaskId === null);

  return (
    <main style={pageStyle}>
      <h1>Tasks</h1>

      <section style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        <nav>
          <h2 style={h2Style}>Projects</h2>
          {projects.map((p) => (
            <button key={p.id} onClick={() => openProject(p.id)} style={linkStyle}>
              {p.name}
            </button>
          ))}
        </nav>
        <nav>
          <h2 style={h2Style}>Lists</h2>
          {lists.map((l) => (
            <button key={l.id} onClick={() => openList(l.id)} style={linkStyle}>
              {l.name}
            </button>
          ))}
        </nav>
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2 style={h2Style}>Tree</h2>
        <ul style={{ margin: 0, padding: 0 }}>
          {roots.map((t) => (
            <TaskTree key={t.id} task={t} />
          ))}
        </ul>
        {roots.length === 0 ? <p style={{ opacity: 0.6 }}>Pick a list.</p> : null}
      </section>
    </main>
  );
}

const pageStyle = {
  padding: '2rem',
  maxWidth: '760px',
  margin: '0 auto',
  fontFamily: 'system-ui, sans-serif',
} as const;
const h2Style = { fontSize: '0.9rem', textTransform: 'uppercase', opacity: 0.6 } as const;
const linkStyle = {
  display: 'block',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  padding: '0.25rem 0',
  textAlign: 'left',
} as const;
