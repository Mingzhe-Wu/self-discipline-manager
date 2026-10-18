import type { Task } from "../../shared/types/task";

interface TaskItemProps {
    task: Task;
    onToggle: (task: Task) => void;
    onDelete: (id: number) => void;
}

function TaskItem({
    task,
    onToggle,
    onDelete,
}: TaskItemProps) {
    return (
        <div>
            <input
                type="checkbox"
                checked={task.completed}
                onChange={() => {
                    onToggle(task);
                }}
            />

            <span>{task.title}</span>

            <button
                onClick={() => {
                    onDelete(task.id);
                }}
            >
                Delete
            </button>
        </div>
    );
}

export default TaskItem;