#!/usr/bin/env node
import { FastMCP, UserError } from 'fastmcp';
import { z } from 'zod';
import { storage } from './storage.js';
import { SEQUENTIAL_THINKING_PROMPT, formatPlanAsTodos } from './prompts.js';
import { Goal, Todo } from './types.js';

class SoftwarePlanningServer {
  private server: FastMCP;
  private currentGoal: Goal | null = null;

  constructor() {
    this.server = new FastMCP({
      name: 'software-planning-tool',
      version: '0.1.0',
    });

    this.setupResources();
    this.setupTools();
  }

  private setupResources() {
    // Define resources with proper context binding using arrow functions
    this.server.addResource({
      uri: 'planning://current-goal',
      name: 'Current Goal',
      mimeType: 'application/json',
      load: async () => {
        if (!this.currentGoal) {
          throw new UserError('No active goal. Start a new planning session first.');
        }
        return {
          text: JSON.stringify(this.currentGoal, null, 2),
        };
      }
    });

    this.server.addResource({
      uri: 'planning://implementation-plan',
      name: 'Implementation Plan',
      mimeType: 'application/json',
      load: async () => {
        if (!this.currentGoal) {
          throw new UserError('No active goal. Start a new planning session first.');
        }
        const plan = await storage.getPlan(this.currentGoal.id);
        if (!plan) {
          throw new UserError('No implementation plan found for current goal.');
        }
        return {
          text: JSON.stringify(plan, null, 2),
        };
      }
    });
  }

  private setupTools() {
    // Start planning tool
    this.server.addTool({
      name: 'start_planning',
      description: 'Start a new planning session with a goal',
      parameters: z.object({
        goal: z.string().describe('The software development goal to plan')
      }),
      execute: async (args) => {
        this.currentGoal = await storage.createGoal(args.goal);
        await storage.createPlan(this.currentGoal.id);

        return SEQUENTIAL_THINKING_PROMPT;
      }
    });

    // Save plan tool
    this.server.addTool({
      name: 'save_plan',
      description: 'Save the current implementation plan',
      parameters: z.object({
        plan: z.string().describe('The implementation plan text to save')
      }),
      execute: async (args) => {
        if (!this.currentGoal) {
          throw new UserError('No active goal. Start a new planning session first.');
        }

        const todos = formatPlanAsTodos(args.plan);

        for (const todo of todos) {
          await storage.addTodo(this.currentGoal.id, todo);
        }

        return `Successfully saved ${todos.length} todo items to the implementation plan.`;
      }
    });

    // Add todo tool
    this.server.addTool({
      name: 'add_todo',
      description: 'Add a new todo item to the current plan',
      parameters: z.object({
        title: z.string().describe('Title of the todo item'),
        description: z.string().describe('Detailed description of the todo item'),
        complexity: z.number().min(0).max(10).describe('Complexity score (0-10)'),
        codeExample: z.string().optional().describe('Optional code example')
      }),
      execute: async (args: any) => {
        if (!this.currentGoal) {
          throw new UserError('No active goal. Start a new planning session first.');
        }

        const newTodo = await storage.addTodo(this.currentGoal.id, args);
        return JSON.stringify(newTodo, null, 2);
      }
    });

    // Remove todo tool
    this.server.addTool({
      name: 'remove_todo',
      description: 'Remove a todo item from the current plan',
      parameters: z.object({
        todoId: z.string().describe('ID of the todo item to remove')
      }),
      execute: async (args) => {
        if (!this.currentGoal) {
          throw new UserError('No active goal. Start a new planning session first.');
        }

        await storage.removeTodo(this.currentGoal.id, args.todoId);
        return `Successfully removed todo ${args.todoId}`;
      }
    });

    // Get todos tool
    this.server.addTool({
      name: 'get_todos',
      description: 'Get all todos in the current plan',
      parameters: z.object({}),
      execute: async () => {
        if (!this.currentGoal) {
          throw new UserError('No active goal. Start a new planning session first.');
        }

        const todos = await storage.getTodos(this.currentGoal.id);
        return JSON.stringify(todos, null, 2);
      }
    });

    // Update todo status tool
    this.server.addTool({
      name: 'update_todo_status',
      description: 'Update the completion status of a todo item',
      parameters: z.object({
        todoId: z.string().describe('ID of the todo item'),
        isComplete: z.boolean().describe('New completion status')
      }),
      execute: async (args) => {
        if (!this.currentGoal) {
          throw new UserError('No active goal. Start a new planning session first.');
        }

        const updatedTodo = await storage.updateTodoStatus(
          this.currentGoal.id,
          args.todoId,
          args.isComplete
        );

        return JSON.stringify(updatedTodo, null, 2);
      }
    });
  }

  async run() {
    await storage.initialize();
    this.server.start({
      transportType: 'stdio'
    });
    console.error('Software Planning MCP server running on stdio');
  }
}

const server = new SoftwarePlanningServer();
server.run().catch(console.error);
