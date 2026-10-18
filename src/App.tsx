import { useEffect, useState } from "react";
import type { Task } from "../shared/types/task";
import TaskForm from "./components/TaskForm";
import TaskList from "./components/TaskList";
import Reminders from "./components/Reminders";

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return "Something went wrong";
}

function App() {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadTasks() {
            try {
                setError("");

                const loadedTasks =
                    await window.electronAPI.listTasks();

                setTasks(loadedTasks);
            } catch (error) {
                setError(getErrorMessage(error));
            } finally {
                setLoading(false);
            }
        }

        loadTasks();
    }, []);

    async function handleCreateTask(title: string) {
        try {
            setError("");

            const newTask =
                await window.electronAPI.createTask(title);

            setTasks([
                ...tasks,
                newTask,
            ]);
        } catch (error) {
            setError(getErrorMessage(error));
        }
    }

    async function handleToggleTask(task: Task) {
        try {
            setError("");

            const updatedTask =
                await window.electronAPI.updateTaskCompleted(
                    task.id,
                    !task.completed,
                );

            if (!updatedTask) {
                return;
            }

            setTasks(
                tasks.map((currentTask) =>
                    currentTask.id === updatedTask.id
                        ? updatedTask
                        : currentTask,
                ),
            );
        } catch (error) {
            setError(getErrorMessage(error));
        }
    }

    async function handleDeleteTask(id: number) {
        try {
            setError("");

            await window.electronAPI.deleteTask(id);

            setTasks(
                tasks.filter((task) => task.id !== id),
            );
        } catch (error) {
            setError(getErrorMessage(error));
        }
    }

    return (
        <div>
            <h1>Self Discipline Manager</h1>

            {error && (
                <p>{error}</p>
            )}

            <TaskForm
                onCreate={handleCreateTask}
            />

            {loading ? (
                <p>Loading...</p>
            ) : tasks.length === 0 ? (
                <p>No tasks yet.</p>
            ) : (
                <TaskList
                    tasks={tasks}
                    onToggle={handleToggleTask}
                    onDelete={handleDeleteTask}
                />
            )}
            <Reminders />
        </div>
    );
}

export default App;
