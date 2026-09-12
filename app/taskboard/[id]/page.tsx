import TaskWorkspace from './task-workspace'

export const metadata = { title: 'Job workspace | ClawdMarket' }

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TaskWorkspace taskId={id} />
}
