import { useState } from "react";

interface TaskFormProps {
    onCreate: (title: string) => void;
}

function TaskForm({
    onCreate,
}: TaskFormProps) {
    const [title, setTitle] = useState("");

    function handleSubmit() {
        if (!title.trim()) {
            return;
        }

        onCreate(title);
        setTitle("");
    }

    return (
        <div>
            <input
                value={title}
                onChange={(event) => {
                    setTitle(event.target.value);
                }}
            />

            <button onClick={handleSubmit}>
                Add Task
            </button>
        </div>
    );
}

export default TaskForm;