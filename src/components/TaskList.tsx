import type { Task } from "../../shared/types/task";
import TaskItem from "./TaskItem";

interface TaskListProps {
    tasks: Task[];
    onToggle: (task: Task) => void;
    onDelete: (id: number) => void;
}

function TaskList({
    tasks,
    onToggle,
    onDelete,
}: TaskListProps) {
    return (
        <div>
            {tasks.map((task) => (
                <TaskItem
                    key={task.id}
                    task={task}
                    onToggle={onToggle}
                    onDelete={onDelete}
                />
            ))}
        </div>
    );
}

export default TaskList;