import { useTranslation } from 'react-i18next';
import styles from './ClusterBadge.module.scss';

export interface ClusterBadgeProps {
  aggregated: boolean;
  /** Number of nodes that contributed traffic in the query window. */
  nodeCount?: number;
  /** Number of nodes alive in the cluster (heartbeat fresh). When set,
   *  badge shows "N/M nodes" so operators can tell deployed-but-idle
   *  nodes apart from nodes actually contributing data. */
  clusterNodeCount?: number;
}

/**
 * 集群聚合徽章。仅在 backend=pg 返回 cluster.aggregated=true 时显示。
 * 让管理员一眼看出当前数字是 N 个节点的总和而不是某个节点的快照。
 *
 * 显示策略：
 *   - clusterNodeCount > nodeCount: 「聚合自 2/4 节点」(有些节点空闲)
 *   - clusterNodeCount <= nodeCount: 「聚合自 N 节点」(全员贡献，简洁版)
 *   - clusterNodeCount 缺失/0:        「聚合自 N 节点」(legacy fallback)
 */
export function ClusterBadge({ aggregated, nodeCount, clusterNodeCount }: ClusterBadgeProps) {
  const { t } = useTranslation();
  if (!aggregated) return null;
  const active = typeof nodeCount === 'number' && nodeCount > 0 ? nodeCount : 0;
  const total = typeof clusterNodeCount === 'number' && clusterNodeCount > 0 ? clusterNodeCount : 0;
  const showRatio = total > active;
  return (
    <span className={styles.badge} aria-label="cluster-aggregated">
      {showRatio
        ? t('usage_stats.cluster_badge_ratio', { active, total })
        : t('usage_stats.cluster_badge', { count: active })}
    </span>
  );
}
