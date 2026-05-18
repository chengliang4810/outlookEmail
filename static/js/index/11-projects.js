        /* global escapeHtml, formatAbsoluteDateTime, groups, handleApiError, hideModal, loadGroups, renderEmptyStateMarkup, showConfirmModal, showModal, showToast */

        let projectPools = [];
        let selectedProjectKey = '';
        let selectedProjectStatus = '';
        let projectPoolKeyword = '';
        let projectPoolKeywordTimer = null;

        const PROJECT_POOL_STATUSES = {
            toClaim: { label: '待领取', className: 'ready' },
            claiming: { label: '领取中', className: 'running' },
            done: { label: '已完成', className: 'done' },
            failed: { label: '失败', className: 'failed' },
            removed: { label: '已移除', className: 'removed' },
            deleted: { label: '已删除', className: 'deleted' }
        };

        function getProjectPoolStatusConfig(status) {
            return PROJECT_POOL_STATUSES[status] || { label: status || '-', className: 'muted' };
        }

        function hideProjectPoolModal() {
            hideModal('projectPoolModal');
        }

        async function showProjectPoolModal() {
            showModal('projectPoolModal');
            resetProjectPoolAccountPane();
            renderProjectPoolGroupOptions();
            if (!groups || groups.length === 0) {
                try {
                    await loadGroups();
                } catch (error) {
                    showToast('加载分组失败', 'error');
                }
            }
            renderProjectPoolGroupOptions();
            await loadProjectPools();
        }

        function resetProjectPoolAccountPane() {
            selectedProjectKey = '';
            selectedProjectStatus = '';
            projectPoolKeyword = '';
            const statusSelect = document.getElementById('projectPoolStatusFilter');
            const keywordInput = document.getElementById('projectPoolKeyword');
            if (statusSelect) statusSelect.value = '';
            if (keywordInput) keywordInput.value = '';
            const title = document.getElementById('projectPoolSelectedTitle');
            const meta = document.getElementById('projectPoolSelectedMeta');
            const list = document.getElementById('projectPoolAccountList');
            if (title) title.textContent = '请选择项目池';
            if (meta) meta.textContent = '创建或选择一个项目池后查看邮箱状态。';
            if (list) {
                list.innerHTML = '<div class="project-pool-empty">暂无选中的项目池</div>';
            }
        }

        function normalizeProjectKeyInput(value) {
            return String(value || '')
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, '');
        }

        function getSelectedProjectPoolGroupIds() {
            return Array.from(document.querySelectorAll('.project-pool-group-checkbox:checked'))
                .map(input => Number.parseInt(input.value, 10))
                .filter(Number.isFinite);
        }

        function getProjectPoolGroupName(groupId) {
            const group = (groups || []).find(item => Number(item.id) === Number(groupId));
            return group ? group.name : `分组 ${groupId}`;
        }

        function getProjectPoolScopeLabel(project) {
            if (!project || project.scope_mode !== 'groups') {
                return '全部分组';
            }
            const groupIds = Array.isArray(project.group_ids) ? project.group_ids : [];
            if (!groupIds.length) {
                return '全部分组';
            }
            return groupIds.map(getProjectPoolGroupName).join('、');
        }

        function renderProjectPoolGroupOptions(selectedIds = []) {
            const container = document.getElementById('projectPoolGroupList');
            if (!container) return;

            if (!groups || groups.length === 0) {
                container.innerHTML = '<div class="project-pool-empty">暂无分组</div>';
                return;
            }

            const selectedSet = new Set((selectedIds || []).map(Number));
            container.innerHTML = groups.map(group => {
                const checked = selectedSet.has(Number(group.id)) ? 'checked' : '';
                const color = group.color || '#6b7280';
                const count = Number(group.account_count || 0);
                return `
                    <label class="project-pool-group-option">
                        <input class="project-pool-group-checkbox" type="checkbox" value="${Number(group.id)}" ${checked}>
                        <span class="project-pool-group-option__body">
                            <span class="project-pool-group-color" style="background-color: ${escapeHtml(color)}"></span>
                            <span class="project-pool-group-name">${escapeHtml(group.name)}</span>
                            <span class="project-pool-group-count">${count} 个邮箱</span>
                        </span>
                    </label>
                `;
            }).join('');
        }

        function clearProjectPoolGroups() {
            document.querySelectorAll('.project-pool-group-checkbox').forEach(input => {
                input.checked = false;
            });
        }

        function fillProjectPoolForm(project) {
            if (!project) return;
            const keyInput = document.getElementById('projectPoolKey');
            const nameInput = document.getElementById('projectPoolName');
            const descriptionInput = document.getElementById('projectPoolDescription');
            const aliasInput = document.getElementById('projectPoolUseAliasEmail');

            if (keyInput) keyInput.value = project.project_key || '';
            if (nameInput) nameInput.value = project.name || project.project_key || '';
            if (descriptionInput) descriptionInput.value = project.description || '';
            if (aliasInput) aliasInput.checked = !!project.use_alias_email;
            renderProjectPoolGroupOptions(project.scope_mode === 'groups' ? project.group_ids || [] : []);
        }

        function resetProjectPoolForm() {
            const keyInput = document.getElementById('projectPoolKey');
            const nameInput = document.getElementById('projectPoolName');
            const descriptionInput = document.getElementById('projectPoolDescription');
            const aliasInput = document.getElementById('projectPoolUseAliasEmail');

            if (keyInput) keyInput.value = '';
            if (nameInput) nameInput.value = '';
            if (descriptionInput) descriptionInput.value = '';
            if (aliasInput) aliasInput.checked = false;
            clearProjectPoolGroups();
        }

        async function loadProjectPools({ keepSelection = true } = {}) {
            const container = document.getElementById('projectPoolList');
            if (container) {
                container.innerHTML = '<div class="project-pool-empty">加载中...</div>';
            }

            try {
                const response = await fetch('/api/projects');
                const data = await response.json();
                if (handleApiError(data, '加载项目池失败')) return;

                projectPools = data?.data?.projects || [];
                renderProjectPoolList(projectPools);
                if (keepSelection && selectedProjectKey && projectPools.some(project => project.project_key === selectedProjectKey)) {
                    await loadProjectPoolAccounts(selectedProjectKey, selectedProjectStatus, projectPoolKeyword);
                }
            } catch (error) {
                if (container) {
                    container.innerHTML = renderEmptyStateMarkup('⚠️', '加载项目池失败', {
                        onAction: 'loadProjectPools()',
                        actionTitle: '刷新项目池'
                    });
                }
                showToast('加载项目池失败', 'error');
            }
        }

        function renderProjectPoolList(projects) {
            const container = document.getElementById('projectPoolList');
            if (!container) return;

            if (!projects.length) {
                container.innerHTML = renderEmptyStateMarkup('📦', '暂无项目池');
                return;
            }

            container.innerHTML = projects.map(project => {
                const active = project.project_key === selectedProjectKey ? 'is-active' : '';
                const scopeLabel = getProjectPoolScopeLabel(project);
                return `
                    <button class="project-pool-card ${active}" type="button" onclick="selectProjectPool('${escapeHtml(project.project_key)}')">
                        <span class="project-pool-card__main">
                            <span class="project-pool-card__title">${escapeHtml(project.name || project.project_key)}</span>
                            <span class="project-pool-card__key">${escapeHtml(project.project_key)}</span>
                        </span>
                        <span class="project-pool-card__meta">${escapeHtml(scopeLabel)}${project.use_alias_email ? ' · 别名' : ''}</span>
                        <span class="project-pool-stats">
                            <span>待领 <strong>${Number(project.to_claim_count || 0)}</strong></span>
                            <span>领取 <strong>${Number(project.claiming_count || 0)}</strong></span>
                            <span>成功 <strong>${Number(project.done_count || 0)}</strong></span>
                            <span>失败 <strong>${Number(project.failed_count || 0)}</strong></span>
                        </span>
                    </button>
                `;
            }).join('');
        }

        async function saveProjectPool() {
            const keyInput = document.getElementById('projectPoolKey');
            const nameInput = document.getElementById('projectPoolName');
            const descriptionInput = document.getElementById('projectPoolDescription');
            const aliasInput = document.getElementById('projectPoolUseAliasEmail');
            const saveBtn = document.getElementById('saveProjectPoolBtn');

            const projectKey = normalizeProjectKeyInput(keyInput?.value);
            if (!projectKey) {
                showToast('请填写项目标识', 'warning');
                keyInput?.focus();
                return;
            }
            if (keyInput) keyInput.value = projectKey;

            const payload = {
                project_key: projectKey,
                name: (nameInput?.value || '').trim() || projectKey,
                description: (descriptionInput?.value || '').trim(),
                group_ids: getSelectedProjectPoolGroupIds(),
                use_alias_email: !!aliasInput?.checked
            };

            const originalText = saveBtn ? saveBtn.textContent : '';
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = '同步中...';
            }

            try {
                const response = await fetch('/api/projects/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (handleApiError(data, '保存项目池失败')) return;

                const result = data.data || {};
                selectedProjectKey = projectKey;
                showToast(`项目池已同步，新增 ${Number(result.added_count || 0)} 个邮箱`, 'success');
                await loadProjectPools({ keepSelection: false });
                await selectProjectPool(projectKey);
            } catch (error) {
                showToast('保存项目池失败', 'error');
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = originalText || '创建 / 同步';
                }
            }
        }

        async function selectProjectPool(projectKey, status = selectedProjectStatus) {
            selectedProjectKey = String(projectKey || '').trim();
            selectedProjectStatus = status || '';
            const project = projectPools.find(item => item.project_key === selectedProjectKey);
            if (project) {
                fillProjectPoolForm(project);
            }
            renderProjectPoolList(projectPools);
            await loadProjectPoolAccounts(selectedProjectKey, selectedProjectStatus, projectPoolKeyword);
        }

        function buildProjectPoolAccountQuery(status, keyword) {
            const params = new URLSearchParams();
            if (status) params.set('status', status);
            if (keyword) params.set('keyword', keyword);
            const query = params.toString();
            return query ? `?${query}` : '';
        }

        async function loadProjectPoolAccounts(projectKey, status = '', keyword = '') {
            const container = document.getElementById('projectPoolAccountList');
            const title = document.getElementById('projectPoolSelectedTitle');
            const meta = document.getElementById('projectPoolSelectedMeta');
            if (!container || !projectKey) return;

            container.innerHTML = '<div class="project-pool-empty">加载邮箱中...</div>';
            try {
                const query = buildProjectPoolAccountQuery(status, keyword);
                const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/accounts${query}`);
                const data = await response.json();
                if (handleApiError(data, '加载项目邮箱失败')) return;

                const result = data.data || {};
                const project = result.project || {};
                if (title) title.textContent = project.name || project.project_key || projectKey;
                if (meta) {
                    meta.textContent = `${project.project_key || projectKey} · ${getProjectPoolScopeLabel(project)} · 共 ${Number(project.total_count || 0)} 个邮箱`;
                }
                renderProjectPoolAccounts(result.accounts || []);
            } catch (error) {
                container.innerHTML = renderEmptyStateMarkup('⚠️', '加载项目邮箱失败', {
                    onAction: 'refreshSelectedProjectPool()',
                    actionTitle: '刷新邮箱'
                });
                showToast('加载项目邮箱失败', 'error');
            }
        }

        function renderProjectPoolAccounts(accounts) {
            const container = document.getElementById('projectPoolAccountList');
            if (!container) return;

            if (!accounts.length) {
                container.innerHTML = renderEmptyStateMarkup('📭', '当前筛选下暂无邮箱');
                return;
            }

            container.innerHTML = `
                <div class="project-pool-account-table-wrap">
                    <table class="project-pool-account-table">
                        <thead>
                            <tr>
                                <th>邮箱</th>
                                <th>状态</th>
                                <th>调用方</th>
                                <th>更新时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${accounts.map(renderProjectPoolAccountRow).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        function renderProjectPoolAccountRow(account) {
            const status = getProjectPoolStatusConfig(account.project_status);
            const email = account.email || account.normalized_email || '';
            const groupText = account.group_name ? `分组：${account.group_name}` : '';
            const primaryText = account.primary_email && account.primary_email !== email ? `主邮箱：${account.primary_email}` : '';
            const remarkText = account.remark ? `备注：${account.remark}` : '';
            const caller = account.caller_id || '-';
            const task = account.task_id || '';
            const lease = account.lease_expires_at ? `租约至：${formatAbsoluteDateTime(account.lease_expires_at)}` : '';
            const detail = account.last_result_detail ? `<div class="project-pool-row-detail">${escapeHtml(account.last_result_detail)}</div>` : '';
            const accountId = Number(account.account_id || 0);

            return `
                <tr class="project-pool-account-row">
                    <td>
                        <div class="project-pool-account-email">${escapeHtml(email)}</div>
                        <div class="project-pool-account-meta">${escapeHtml([groupText, primaryText, remarkText].filter(Boolean).join(' · '))}</div>
                        ${detail}
                    </td>
                    <td>
                        <span class="project-pool-status-pill ${status.className}">${escapeHtml(status.label)}</span>
                    </td>
                    <td>
                        <div class="project-pool-account-caller">${escapeHtml(caller)}</div>
                        <div class="project-pool-account-meta">${escapeHtml([task, lease].filter(Boolean).join(' · '))}</div>
                    </td>
                    <td>
                        <div class="project-pool-account-time">${escapeHtml(formatAbsoluteDateTime(account.updated_at))}</div>
                        <div class="project-pool-account-meta">领取 ${Number(account.claim_count || 0)} 次</div>
                    </td>
                    <td class="project-pool-account-actions">
                        ${renderProjectPoolAccountActions(account.project_status, accountId)}
                    </td>
                </tr>
            `;
        }

        function renderProjectPoolAccountActions(status, accountId) {
            if (!accountId) {
                return '<span class="project-pool-action-muted">不可操作</span>';
            }
            const actions = [];
            if (status === 'failed') {
                actions.push(`<button class="btn btn-sm btn-secondary" type="button" onclick="resetProjectPoolFailed(${accountId})">重置</button>`);
            }
            if (status === 'removed') {
                actions.push(`<button class="btn btn-sm btn-secondary" type="button" onclick="restoreProjectPoolAccount(${accountId})">恢复</button>`);
            } else if (status !== 'claiming' && status !== 'deleted') {
                actions.push(`<button class="btn btn-sm btn-danger" type="button" onclick="removeProjectPoolAccount(${accountId})">移除</button>`);
            }
            return actions.join('') || '<span class="project-pool-action-muted">无操作</span>';
        }

        function handleProjectPoolStatusChange(status) {
            selectedProjectStatus = status || '';
            if (!selectedProjectKey) return;
            loadProjectPoolAccounts(selectedProjectKey, selectedProjectStatus, projectPoolKeyword);
        }

        function handleProjectPoolKeywordInput() {
            const input = document.getElementById('projectPoolKeyword');
            projectPoolKeyword = (input?.value || '').trim();
            clearTimeout(projectPoolKeywordTimer);
            projectPoolKeywordTimer = setTimeout(() => {
                if (selectedProjectKey) {
                    loadProjectPoolAccounts(selectedProjectKey, selectedProjectStatus, projectPoolKeyword);
                }
            }, 260);
        }

        async function refreshSelectedProjectPool() {
            if (!selectedProjectKey) {
                showToast('请先选择项目池', 'warning');
                return;
            }
            await loadProjectPools();
        }

        async function postProjectPoolAccountAction(pathSuffix, accountId, successMessage, errorMessage) {
            if (!selectedProjectKey) {
                showToast('请先选择项目池', 'warning');
                return;
            }

            try {
                const response = await fetch(`/api/projects/${encodeURIComponent(selectedProjectKey)}${pathSuffix}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ account_id: accountId, detail: 'managed_from_web_ui' })
                });
                const data = await response.json();
                if (handleApiError(data, errorMessage)) return;
                showToast(data.message || successMessage, 'success');
                await loadProjectPools();
            } catch (error) {
                showToast(errorMessage, 'error');
            }
        }

        async function resetProjectPoolFailed(accountId) {
            await postProjectPoolAccountAction('/reset-failed', accountId, '失败邮箱已重置', '重置失败邮箱失败');
        }

        async function removeProjectPoolAccount(accountId) {
            const confirmed = await showConfirmModal('确定要从当前项目池移除这个邮箱吗？', {
                title: '移除项目邮箱',
                confirmText: '确认移除',
                danger: true
            });
            if (!confirmed) return;
            await postProjectPoolAccountAction('/remove-account', accountId, '项目邮箱已移除', '移除项目邮箱失败');
        }

        async function restoreProjectPoolAccount(accountId) {
            await postProjectPoolAccountAction('/restore-account', accountId, '项目邮箱已恢复', '恢复项目邮箱失败');
        }
