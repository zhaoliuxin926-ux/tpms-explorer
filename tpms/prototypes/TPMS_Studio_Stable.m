function TPMS_Studio_Stable()
    fig = uifigure('Name', 'TPMS 晶胞工作室 - 纯净稳定版', 'Position', [100, 100, 950, 650]);
    
    ax = uiaxes(fig, 'Position', [320, 50, 600, 570]);
    view(ax, 3); daspect(ax, [1 1 1]); grid(ax, 'on'); box(ax, 'on');
    xlabel(ax, 'X (mm)'); ylabel(ax, 'Y (mm)'); zlabel(ax, 'Z (mm)');
    camlight(ax, 'headlight'); camlight(ax, 'left'); lighting(ax, 'gouraud');
    
    uilabel(fig, 'Text', '1. TPMS 类型:', 'Position', [20, 590, 150, 22], 'FontWeight', 'bold');
    ddType = uidropdown(fig, 'Items', {'Gyroid', 'Schwarz P', 'Schwarz D'}, ...
        'Position', [20, 565, 250, 22], 'ValueChangedFcn', @(dd,e) updatePreview());
        
    uilabel(fig, 'Text', '2. 实体生成模式:', 'Position', [20, 520, 150, 22], 'FontWeight', 'bold');
    bgMode = uibuttongroup(fig, 'Position', [20, 420, 250, 95], 'SelectionChangedFcn', @(bg,e) updatePreview());
    uiradiobutton(bgMode, 'Text', '杆模式 (Solid Network)', 'Position', [10, 65, 200, 22]);
    uiradiobutton(bgMode, 'Text', '壳模式 (Shell/Sheet)', 'Position', [10, 37, 200, 22]);
    uiradiobutton(bgMode, 'Text', '梯度模式 (Z向渐变)', 'Position', [10, 9, 200, 22]);
    
    uilabel(fig, 'Text', '3. 晶胞周期 (mm):', 'Position', [20, 385, 200, 22], 'FontWeight', 'bold');
    slPeriod = uislider(fig, 'Limits', [2, 10], 'Value', 5, 'Position', [20, 360, 240, 3], 'ValueChangedFcn', @(sl,e) updatePreview());
    
    uilabel(fig, 'Text', '4. 等值面偏置:', 'Position', [20, 315, 200, 22], 'FontWeight', 'bold');
    slBias = uislider(fig, 'Limits', [-1.0, 1.0], 'Value', 0, 'Position', [20, 290, 240, 3], 'ValueChangedFcn', @(sl,e) updatePreview());

    uilabel(fig, 'Text', '5. 壳体壁厚 (mm):', 'Position', [20, 245, 200, 22], 'FontWeight', 'bold');
    slThick = uislider(fig, 'Limits', [0.1, 2.0], 'Value', 0.6, 'Position', [20, 220, 240, 3], 'ValueChangedFcn', @(sl,e) updatePreview());

    uilabel(fig, 'Text', '6. 自定义文件名 (可选):', 'Position', [20, 175, 200, 22], 'FontWeight', 'bold');
    edtName = uieditfield(fig, 'text', 'Value', 'My_TPMS_Cell', 'Position', [20, 150, 240, 22]);

    btnExport = uibutton(fig, 'push', 'Text', '🚀 选择路径并导出高精度 STL', ...
        'Position', [20, 75, 250, 50], 'FontWeight', 'bold', 'FontSize', 14, ...
        'BackgroundColor', [0.9 0.95 1], 'ButtonPushedFcn', @(btn,e) exportModel());
    
    lblStatus = uilabel(fig, 'Text', '状态: 就绪', 'Position', [20, 40, 280, 22], 'FontColor', [0 0.5 0]);

    p = patch(ax, 'Faces', [], 'Vertices', [], 'EdgeColor', 'none', 'BackFaceLighting', 'lit');

    function [f, v, F_final, X, Y, Z] = computeMesh(res, isExport)
        D = 10; H = 10; 
        
        % 【已修复】：不再使用 single，统一采用 MATLAB 默认最稳定的 double 矩阵格式
        x = linspace(-D/2 - 0.5, D/2 + 0.5, res);
        y = linspace(-D/2 - 0.5, D/2 + 0.5, res);
        z = linspace(-0.5, H + 0.5, res);
        [X, Y, Z] = meshgrid(x, y, z);
        
        w = 2*pi / slPeriod.Value;
        switch ddType.Value
            case 'Gyroid',    V = sin(w*X).*cos(w*Y) + sin(w*Y).*cos(w*Z) + sin(w*Z).*cos(w*X);
            case 'Schwarz P', V = cos(w*X) + cos(w*Y) + cos(w*Z);
            case 'Schwarz D', V = cos(w*X).*cos(w*Y).*cos(w*Z) - sin(w*X).*sin(w*Y).*sin(w*Z);
        end
        
        F_cyl = sqrt(X.^2 + Y.^2) - D/2;
        F_ztop = Z - H;
        F_zbot = -Z;
        F_bound = max(F_cyl, max(F_ztop, F_zbot)); 
        
        bias = slBias.Value; 
        t = slThick.Value;
        mode = bgMode.SelectedObject.Text;
        
        if contains(mode, '杆')
            F_tpms = bias - V;
        elseif contains(mode, '壳')
            F_tpms = (V - bias).^2 - (t/2)^2;
        elseif contains(mode, '梯度')
            T_grad = t .* max(0, min(H, Z)) / H;
            F_tpms = (V - bias).^2 - (T_grad/2).^2;
        end
        
        F_final = max(F_tpms, F_bound);
        
        if isExport
            F_final = smooth3(F_final, 'box', 3);
        end
        
        [f, v] = isosurface(X, Y, Z, F_final, 0);
    end

    function updatePreview()
        lblStatus.Text = '状态: 正在渲染预览...'; drawnow;
        [f, v, F_final, X, Y, Z] = computeMesh(65, false);
        p.Faces = f; p.Vertices = v;
        if ~isempty(f), isonormals(X, Y, Z, F_final, p); end
        
        if contains(bgMode.SelectedObject.Text, '杆')
            p.FaceColor = [0.8 0.4 0.2];
        else
            p.FaceColor = [0.2 0.6 0.8]; 
        end
        lblStatus.Text = '状态: 预览已就绪';
    end

    function exportModel()
        targetRes = 250; 
        customName = strtrim(edtName.Value); 
        
        if isempty(customName)
            modeStr = bgMode.SelectedObject.Text;
            typeStr = strrep(ddType.Value, ' ', '');
            defaultName = sprintf('TPMS_%s_%s.stl', typeStr, modeStr(1:2));
        else
            if ~endsWith(lower(customName), '.stl')
                defaultName = [customName, '.stl'];
            else
                defaultName = customName;
            end
        end
        
        [file, path] = uiputfile('*.stl', '保存 STL 模型', defaultName);
        if isequal(file, 0) || isequal(path, 0)
            lblStatus.Text = '状态: 已取消导出';
            lblStatus.FontColor = [0.5 0.5 0.5];
            return;
        end
        
        fullFilePath = fullfile(path, file); 
        lblStatus.Text = '状态: 正在生成超高精度封闭网格... (需要几秒钟)'; 
        lblStatus.FontColor = [0.8 0 0]; 
        btnExport.Enable = 'off'; 
        drawnow;
        
        tic; 
        try
            [f_high, v_high] = computeMesh(targetRes, true);
            if isempty(f_high), error('生成的模型为空。'); end
            
            % 核心修复：确保传入 triangulation 的一定是纯正的 double 格式
            TR = triangulation(double(f_high), double(v_high));
            stlwrite(TR, fullFilePath); 
            t_cost = toc;
            
            lblStatus.Text = sprintf('状态: 导出成功! 耗时 %.1f 秒', t_cost);
            lblStatus.FontColor = [0 0.5 0];
            msgbox(sprintf('高精度 STL 生成完毕！\n\n面数: %d\n耗时: %.1f 秒\n路径:\n%s', ...
                   size(f_high,1), t_cost, fullFilePath), '导出成功', 'help');
        catch ME
            lblStatus.Text = '状态: 导出失败'; 
            lblStatus.FontColor = [0.8 0 0];
            uialert(fig, sprintf('导出失败！\n原因: %s', ME.message), '致命错误');
        end
        btnExport.Enable = 'on'; 
    end

    updatePreview(); 
end