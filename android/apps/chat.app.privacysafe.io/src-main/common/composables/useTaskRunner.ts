/*
Copyright (C) 2025 3NSoft Inc.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with
this program. If not, see <http://www.gnu.org/licenses/>.
*/
import { ref } from 'vue';
import { schedulerYield } from '@v1nt1248/3nclient-lib/utils';
import type { Task, TaskRunnerInstance } from '~/index';

export function useTaskRunner(maxNumberOfRunners = 1): TaskRunnerInstance {
  const arrayOfTasks = ref<Task[]>([]);
  const numberOfRunners = ref(0);

  function nextTask(): Task | undefined {
    return arrayOfTasks.value.shift();
  }

  function cancelTasks(): void {
    arrayOfTasks.value = [];
  }

  async function sequenceRunner() {
    let task = nextTask();

    if (task) {
      numberOfRunners.value += 1;
    }

    while (task) {
      await task();
      task = nextTask();
      await schedulerYield();
    }

    numberOfRunners.value -= 1;
  }

  function addTask(task: Task) {
    arrayOfTasks.value.push(task);

    if (numberOfRunners.value >= maxNumberOfRunners) {
      return;
    }

    sequenceRunner();
  }

  return {
    addTask,
    cancelTasks,
  };
}
