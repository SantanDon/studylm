import React from 'react';
import { useTasks, Task } from '@/hooks/useTasks';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, Clock, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const TaskPulse = ({ notebookId }: { notebookId: string }) => {
  const { tasks, isLoading } = useTasks(notebookId);

  if (isLoading) return <div className="p-4 text-xs text-gray-400">Syncing actionable knowledge...</div>;
  if (!tasks || tasks.length === 0) return null;

  const getPriorityColor = (p: string) => {
    switch (p) {
      case 'high': return 'bg-red-100 text-red-600 border-red-200';
      case 'medium': return 'bg-amber-100 text-amber-600 border-amber-200';
      default: return 'bg-blue-100 text-blue-600 border-blue-200';
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center">
          <CheckCircle2 className="w-3 h-3 mr-2 text-indigo-500" />
          Actionable Knowledge
        </h3>
        <Badge variant="outline" className="text-[10px] py-0 h-4 border-indigo-100 text-indigo-500">
          {tasks.length} Active
        </Badge>
      </div>

      <div className="space-y-2">
        <AnimatePresence>
          {tasks.map((task: Task) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <Card className="bg-white/50 backdrop-blur-sm border-gray-100 hover:border-indigo-100 transition-all group overflow-hidden">
                <CardContent className="p-3 flex items-start space-x-3">
                  <div className="mt-0.5">
                    {task.status === 'completed' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Circle className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 cursor-pointer transition-colors" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${task.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-700'} leading-relaxed`}>
                      {task.content}
                    </p>
                    <div className="flex items-center mt-2 space-x-3 whitespace-nowrap">
                      <Badge className={`text-[10px] px-1.5 py-0 ${getPriorityColor(task.priority)}`}>
                        {task.priority}
                      </Badge>
                      <div className="flex items-center text-[10px] text-gray-400">
                        <Clock className="w-2.5 h-2.5 mr-1" />
                        {new Date(task.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default TaskPulse;
