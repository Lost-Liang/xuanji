// library-book/src/main/java/com/library/book/service/impl/CategoryServiceImpl.java
package com.library.book.service.impl;

import java.util.List;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.library.book.domain.Category;
import com.library.book.mapper.CategoryMapper;
import com.library.book.service.CategoryService;
import com.library.book.exception.ServiceException;

/**
 * 图书分类服务实现
 */
@Service
public class CategoryServiceImpl extends ServiceImpl<CategoryMapper, Category>
        implements CategoryService {

    @Override
    public void saveCategory(Category category) {
        save(category);
    }

    @Override
    public void updateCategory(Category category) {
        updateById(category);
    }

    @Override
    public void deleteCategory(Long id) {
        removeById(id);
    }

    @Override
    public List<Category> getCategoryTree() {
        List<Category> allCategories = list();

        // 构建树形结构
        return allCategories.stream()
                .filter(c -> c.getParentId() == null || c.getParentId() == 0)
                .map(c -> {
                    c.setChildren(getChildren(c, allCategories));
                    return c;
                })
                .collect(Collectors.toList());
    }

    @Override
    public Category getCategoryById(Long id) {
        Category category = getById(id);
        if (category == null) {
            throw new ServiceException("分类不存在");
        }
        return category;
    }

    private List<Category> getChildren(Category parent, List<Category> allCategories) {
        return allCategories.stream()
                .filter(c -> parent.getId().equals(c.getParentId()))
                .map(c -> {
                    c.setChildren(getChildren(c, allCategories));
                    return c;
                })
                .collect(Collectors.toList());
    }
}