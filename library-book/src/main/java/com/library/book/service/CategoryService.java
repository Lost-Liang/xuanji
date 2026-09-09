// library-book/src/main/java/com/library/book/service/CategoryService.java
package com.library.book.service;

import java.util.List;
import com.baomidou.mybatisplus.extension.service.IService;
import com.library.book.domain.Category;

/**
 * 图书分类服务接口
 */
public interface CategoryService extends IService<Category> {

    /**
     * 查询分类树
     */
    List<Category> getCategoryTree();

    /**
     * 根据ID查询分类
     */
    Category getCategoryById(Long id);
}