import { useTranslation } from 'react-i18next';
import styles from './ClusterBadge.module.scss';

export interface ClusterBadgeProps {
  aggregated: boolean;
  nodeCount?: number;
}

/**
 * 集群聚合徽章。仅在 backend=pg 返回 cluster.aggregated=true 时显示。
 * 让管理员一眼看出当前数字是 N 个节点的总和而不是某个节点的快照。
 */
export function ClusterBadge({ aggregated, nodeCount }: ClusterBadgeProps) {
  const { t } = useTranslation();
  if (!aggregated) return null;
  return (
    <span className={styles.badge} aria-label="cluster-aggregated">
      {t('usage_stats.cluster_badge', {
        count: typeof nodeCount === 'number' && nodeCount > 0 ? nodeCount : 0,
      })}
    </span>
  );
}
